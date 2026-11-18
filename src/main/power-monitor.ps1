param([int]$ParentProcessId=0)
# Bundled Windows event bridge. No credentials, settings or network requests.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Net.NetworkInformation;
using System.Windows.Forms;
public class PokePowerWindow : NativeWindow {
 [DllImport("user32.dll",SetLastError=true)] static extern IntPtr RegisterPowerSettingNotification(IntPtr h,ref Guid g,int flags);
 [DllImport("kernel32.dll")] static extern bool GetSystemPowerStatus(out Status status);
 [StructLayout(LayoutKind.Sequential)] struct Status { public byte AC,Battery,Percent,Saver;public uint Remaining,Full; }
 static Guid display=new Guid("6fe69556-704a-47a0-8f24-c28d936fda47"),saver=new Guid("e00958c0-c213-4ace-ac77-fecced2eeea5");
 public PokePowerWindow(){CreateHandle(new CreateParams());RegisterPowerSettingNotification(Handle,ref display,0);RegisterPowerSettingNotification(Handle,ref saver,0);Status state;if(GetSystemPowerStatus(out state))Console.WriteLine("saver:"+(state.Saver==1?"on":"off"));NetworkChange.NetworkAvailabilityChanged+=(sender,e)=>Console.WriteLine("network:"+(e.IsAvailable?"on":"off"));}
 protected override void WndProc(ref Message m){if(m.Msg==0x218&&m.WParam.ToInt32()==0x8013){Guid setting=(Guid)Marshal.PtrToStructure(m.LParam,typeof(Guid));int value=Marshal.ReadInt32(m.LParam,20);if(setting==display)Console.WriteLine("display:"+(value==0?"off":"on"));if(setting==saver)Console.WriteLine("saver:"+(value==1?"on":"off"));}base.WndProc(ref m);}
}
"@
$pokePowerWindow=New-Object PokePowerWindow
if($ParentProcessId -gt 0){
 $pokeParentProcess=[System.Diagnostics.Process]::GetProcessById($ParentProcessId)
 $pokeParentTimer=New-Object System.Windows.Forms.Timer
 $pokeParentTimer.Interval=2000
 $pokeParentTimer.Add_Tick({if($pokeParentProcess.HasExited){[System.Windows.Forms.Application]::ExitThread()}})
 $pokeParentTimer.Start()
}
[System.Windows.Forms.Application]::Run()
