$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object Text.UTF8Encoding $false
[Console]::OutputEncoding=New-Object Text.UTF8Encoding $false
$request=[Console]::In.ReadToEnd()|ConvertFrom-Json
Add-Type @'
using System;using System.Text;using System.Runtime.InteropServices;
public static class PtbInstanceNative {
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string cls,string title);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
 public static IntPtr FindProfile(string profile){return FindWindowEx(new IntPtr(-3),IntPtr.Zero,"Chrome_MessageWindow",profile);}
 [StructLayout(LayoutKind.Sequential)] public struct ProcessKey {public uint Pid;public System.Runtime.InteropServices.ComTypes.FILETIME Start;}
 [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)] public static extern int RmStartSession(out uint session,uint flags,StringBuilder key);
 [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)] public static extern int RmRegisterResources(uint session,uint files,string[] filenames,uint processes,ProcessKey[] applications,uint services,string[] names);
 [DllImport("rstrtmgr.dll")] public static extern int RmShutdown(uint session,uint flags,IntPtr callback);
 [DllImport("rstrtmgr.dll")] public static extern int RmEndSession(uint session);
}
'@
function Get-PtbProcess($id){
 try{$process=[Diagnostics.Process]::GetProcessById([int]$id);if($process.SessionId -ne [Diagnostics.Process]::GetCurrentProcess().SessionId){return $null};return @{pid=$process.Id;exe=$process.MainModule.FileName;started=$process.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()}}catch{return $null}
}
function Get-CommandExe([string]$command){$match=[regex]::Match($command,'^\s*(?:"([^"]+)"|(.+?\.exe)(?:\s|$))',[Text.RegularExpressions.RegexOptions]::IgnoreCase);if($match.Success){if($match.Groups[1].Success){return $match.Groups[1].Value};return $match.Groups[2].Value};return $null}
switch($request.action){
 'owner' {
  $handle=[PtbInstanceNative]::FindProfile([string]$request.profile)
  [uint32]$owner=0
  if($handle -ne [IntPtr]::Zero){$null=[PtbInstanceNative]::GetWindowThreadProcessId($handle,[ref]$owner)}
  if($owner -gt 0){Get-PtbProcess $owner|ConvertTo-Json -Compress}else{'null'}
 }
 'process' {Get-PtbProcess $request.pid|ConvertTo-Json -Compress}
 'close' {
  $current=Get-PtbProcess $request.pid
  if(-not $current){'{"closed":true}';break}
  if($current.exe -ine [string]$request.exe -or $current.started -ne [string]$request.started){throw 'The previous process identity changed.'}
  $handle=[PtbInstanceNative]::FindProfile([string]$request.profile);[uint32]$owner=0
  if($handle -ne [IntPtr]::Zero){$null=[PtbInstanceNative]::GetWindowThreadProcessId($handle,[ref]$owner)}
  if($owner -ne $current.pid){throw 'The previous process no longer owns this profile.'}
  [uint32]$session=0;$key=New-Object Text.StringBuilder 64
  $code=[PtbInstanceNative]::RmStartSession([ref]$session,0,$key);if($code -ne 0){throw "Restart Manager start failed: $code"}
  try{$stamp=[long]$current.started;$processKey=New-Object PtbInstanceNative+ProcessKey;$processKey.Pid=$current.pid;$filetime=New-Object Runtime.InteropServices.ComTypes.FILETIME;$filetime.dwLowDateTime=[int]($stamp -band 0x7fffffff);if(($stamp -band 2147483648L) -ne 0){$filetime.dwLowDateTime=$filetime.dwLowDateTime -bor [int]::MinValue};$filetime.dwHighDateTime=[int]($stamp -shr 32);$processKey.Start=$filetime
   $code=[PtbInstanceNative]::RmRegisterResources($session,0,$null,1,@($processKey),0,$null);if($code -ne 0){throw "Restart Manager registration failed: $code"}
   $code=[PtbInstanceNative]::RmShutdown($session,0,[IntPtr]::Zero);if($code -ne 0){throw "The previous app could not close safely: $code"}
   '{"closed":true}'
  }finally{$null=[PtbInstanceNative]::RmEndSession($session)}
 }
 'run' {
  $base=if($request.registryBase){[string]$request.registryBase}else{'Software\Microsoft\Windows\CurrentVersion'}
  $run=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($base+'\Run',$false)
  try{
   $rows=@()
   if($run){foreach($name in $run.GetValueNames()){$value=$run.GetValue($name);if($value -is [string]){$target=Get-CommandExe $value;if($target -match '(?:^|[\\/])PokeTokenBar\.exe$'){$rows+=@{name=$name;command=$value;exe=$target}}}}}
   ConvertTo-Json -InputObject $rows -Compress
  }finally{if($run){$run.Dispose()}}
 }
 'migrate-run' {
  $base=if($request.registryBase){[string]$request.registryBase}else{'Software\Microsoft\Windows\CurrentVersion'}
  $run=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($base+'\Run',$true);$changed=@()
  try{
   if($run){foreach($name in $run.GetValueNames()){$value=$run.GetValue($name);if($value -isnot [string]){continue};$target=Get-CommandExe $value;if(-not $target){continue};if(@($request.oldExecutables)|Where-Object{$_ -ieq $target}){
    $match=[regex]::Match($value,'^\s*(?:"([^"]+)"|(.+?\.exe)(?:\s|$))',[Text.RegularExpressions.RegexOptions]::IgnoreCase)
    $tail=$value.Substring($match.Length).TrimStart();if(-not $tail){$tail='--login-start'}
    $run.SetValue($name,'"'+[string]$request.exe+'" '+$tail,[Microsoft.Win32.RegistryValueKind]::String);$changed+=$name
   }}}
   ConvertTo-Json -InputObject @{changed=$changed} -Compress
  }finally{if($run){$run.Dispose()}}
 }
 default {throw 'Invalid instance bridge action.'}
}
