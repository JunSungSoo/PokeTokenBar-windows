import{execFile}from'node:child_process';import{promisify}from'node:util';
// Inspect the actual native clip/input region, without moving the user's pointer.
export async function inspectWindowRegion(window){
 if(process.platform!=='win32')return;
 const handle=window.getNativeWindowHandle().readBigUInt64LE().toString();
 const code=`Add-Type @'
using System;using System.Runtime.InteropServices;
public static class PetRegionProbe {
 [StructLayout(LayoutKind.Sequential)] public struct Rect {public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")] public static extern int GetWindowRgn(IntPtr window,IntPtr region);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window,out Rect rect);
 [DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int left,int top,int right,int bottom);
 [DllImport("gdi32.dll")] public static extern bool PtInRegion(IntPtr region,int x,int y);
 [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr handle);
}
'@
$null=[PetRegionProbe]::SetThreadDpiAwarenessContext([IntPtr](-4))
$region=[PetRegionProbe]::CreateRectRgn(0,0,0,0)
try{$windowHandle=[IntPtr]([long]${handle});$kind=[PetRegionProbe]::GetWindowRgn($windowHandle,$region);$rect=New-Object PetRegionProbe+Rect;$null=[PetRegionProbe]::GetWindowRect($windowHandle,[ref]$rect);$width=$rect.Right-$rect.Left;$height=$rect.Bottom-$rect.Top;[pscustomobject]@{Kind=$kind;Top=[PetRegionProbe]::PtInRegion($region,[int]($width/2),1);Pet=[PetRegionProbe]::PtInRegion($region,[int]($width/2),$height-5);Gutter=[PetRegionProbe]::PtInRegion($region,1,$height-5)}|ConvertTo-Json -Compress}finally{$null=[PetRegionProbe]::DeleteObject($region)}`;
 const {stdout}=await promisify(execFile)('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{windowsHide:true,timeout:10000});return JSON.parse(stdout.trim());
}
