/** Native Windows taskbar hosting; evaluated by the system Windows PowerShell. */
export const taskbarNativeScript = String.raw`param([long]$WindowHandle, [int]$OwnerProcess)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
$assemblies = @([System.Windows.Automation.AutomationElement].Assembly.Location, [System.Windows.Automation.TreeScope].Assembly.Location, [System.Windows.Rect].Assembly.Location) | Select-Object -Unique
Add-Type -ReferencedAssemblies $assemblies -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.ComponentModel;
using System.Threading;
using System.Runtime.InteropServices;
using System.Windows.Automation;
using Microsoft.Win32;
public static class LinkLineTaskbar {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int L,T,R,B; }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr FindWindow(string c, string t);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr p, IntPtr a, string c, string t);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out Rect r);
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetParent(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int n);
  [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int n, int v);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int z, uint flags);
  [DllImport("user32.dll")] static extern bool MoveWindow(IntPtr h, int x, int y, int w, int z, bool repaint);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint process);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
  static IntPtr child,bar,list,rebar;
  static IntPtr originalParent;
  // Explorer can recreate the taskbar while keeping the lyric HWND alive.
  // The next layout may be byte-for-byte identical, so the host must still
  // notify Electron that the HWND was reattached and needs to be shown.
  static bool reattached=false;
  static bool legacy=false;
  static int originalStyle,originalExtendedStyle,oldWidth,oldHeight,oldRebarWidth,oldRebarHeight,offsetX,offsetY;
  static readonly ConcurrentQueue<string> commands=new ConcurrentQueue<string>();
  public static volatile bool InputClosed=false;
  public static void StartInput() {
    var reader=new Thread(delegate() {
      try { string line; while((line=Console.ReadLine())!=null) commands.Enqueue(line); }
      finally { InputClosed=true; }
    });
    reader.IsBackground=true; reader.Start();
  }
  public static string ReadCommand() { string line; return commands.TryDequeue(out line)?line:null; }
  public static void Init(long handle) {
    // UIAutomation rectangles use physical pixels. Match modern Electron's
    // per-monitor awareness before reading or placing native windows.
    try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch(EntryPointNotFoundException) { SetProcessDPIAware(); }
    child=new IntPtr(handle); originalParent=GetParent(child);
    originalStyle=GetWindowLong(child,-16); originalExtendedStyle=GetWindowLong(child,-20);
  }
  public static int Dpi() { try { var d=GetDpiForWindow(bar); return d==0?96:(int)d; } catch(EntryPointNotFoundException) { return 96; } }
  static int Reg(string key, string name, int fallback) {
    using(var k=Registry.CurrentUser.OpenSubKey(key)) { var v=k==null?null:k.GetValue(name); return v is int?(int)v:fallback; }
  }
  public static bool IsLight() { return Reg(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize","SystemUsesLightTheme",0)!=0; }
  public static bool IsCentered() { return Reg(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced","TaskbarAl",1)!=0; }
  static IntPtr Child(IntPtr parent,string name) { return FindWindowEx(parent,IntPtr.Zero,name,null); }
  static void RestoreTaskList() {
    if(legacy && IsWindow(list) && IsWindow(rebar)) {
      Rect r; GetWindowRect(rebar,out r);
      MoveWindow(list,offsetX,offsetY,Math.Max(0,oldWidth+r.R-r.L-oldRebarWidth),Math.Max(0,oldHeight+r.B-r.T-oldRebarHeight),true);
    }
    legacy=false;
  }
  static int[] FreeGap(int left,int right,List<Rect> occupied) {
    occupied.Sort(delegate(Rect a,Rect b) { return a.L.CompareTo(b.L); });
    int cursor=left,bestLeft=left,bestWidth=0;
    foreach(var r in occupied) {
      int l=Math.Max(left,r.L),end=Math.Min(right,r.R);
      if(end<=left || l>=right) continue;
      if(l-cursor>bestWidth) { bestLeft=cursor; bestWidth=l-cursor; }
      cursor=Math.Max(cursor,end);
    }
    if(right-cursor>bestWidth) { bestLeft=cursor; bestWidth=right-cursor; }
    return new int[]{bestLeft,Math.Max(0,bestWidth)};
  }
  public static int[] Spaces(int desiredDip) {
    var next=FindWindow("Shell_TrayWnd",null);
    if(!IsWindow(child)) throw new InvalidOperationException("TASKBAR_WINDOW_LOST");
    if(next==IntPtr.Zero) { RestoreTaskList(); bar=IntPtr.Zero; return new int[]{0,0,0,0,0,0,0,0,96}; }
    if(next!=bar || GetParent(child)!=next) {
      RestoreTaskList();
      bar=next; rebar=Child(bar,"ReBarWindow32");
      if(rebar==IntPtr.Zero) rebar=Child(bar,"WorkerW");
      list=rebar==IntPtr.Zero?IntPtr.Zero:Child(rebar,"MSTaskSwWClass");
      if(list==IntPtr.Zero && rebar!=IntPtr.Zero) list=Child(rebar,"MSTaskListWClass");
      legacy=list!=IntPtr.Zero && Child(bar,"Windows.UI.Composition.DesktopWindowContentBridge")==IntPtr.Zero;
      if(legacy) { Rect r,l; GetWindowRect(rebar,out r); GetWindowRect(list,out l); oldWidth=l.R-l.L; oldHeight=l.B-l.T; oldRebarWidth=r.R-r.L; oldRebarHeight=r.B-r.T; offsetX=l.L-r.L; offsetY=l.T-r.T; }
      // SetParent does not change WS_POPUP/WS_CHILD itself. A proper child
      // style is necessary for Explorer to clip and stack this HWND correctly.
      SetWindowLong(child,-16,(originalStyle&~unchecked((int)0x80CF0000))|0x40000000);
      SetWindowLong(child,-20,(originalExtendedStyle&~0x00040000)|0x08080080);
      SetParent(child,bar);
      if(GetParent(child)!=bar) throw new Win32Exception(Marshal.GetLastWin32Error(),"Could not embed taskbar lyric window");
      SetWindowPos(child,IntPtr.Zero,0,0,0,0,0x0037);
      reattached=true;
    }
    Rect b; GetWindowRect(bar,out b);
    int dpi=Dpi(),desired=(int)Math.Round(desiredDip*dpi/96.0);
    if(b.R-b.L < b.B-b.T) return new int[]{b.L,b.T,0,0,0,0,0,0,dpi};
    if(legacy) {
      Rect r; GetWindowRect(rebar,out r);
      int full=r.R-r.L-offsetX;
      int width=Math.Min(desired,Math.Max(0,full-240));
      MoveWindow(list,offsetX,offsetY,Math.Max(0,full-width-8),r.B-r.T-offsetY,true);
      return new int[]{b.L,b.T,b.R-b.L,b.B-b.T,0,0,r.R-width-b.L,width,dpi};
    }
    double min=double.MaxValue,max=double.MinValue,widgetLeft=0,widgetRight=0;
    IntPtr bridge=IntPtr.Zero;
    while((bridge=FindWindowEx(bar,bridge,"Windows.UI.Composition.DesktopWindowContentBridge",null))!=IntPtr.Zero) {
      try {
        var root=AutomationElement.FromHandle(bridge);
        var items=root.FindAll(TreeScope.Descendants,Condition.TrueCondition);
        for(int i=0;i<items.Count;i++) {
          try {
            var c=items[i].Current; var r=c.BoundingRectangle;
            if(r.IsEmpty || r.Width<=0 || c.IsOffscreen) continue;
            if(c.AutomationId=="WidgetsButton") { widgetLeft=r.Left; widgetRight=r.Right; }
            else if(c.ClassName=="Taskbar.TaskListButtonAutomationPeer" || c.AutomationId=="StartButton" || c.AutomationId=="SearchButton" || c.AutomationId=="SearchBoxTextBlock" || c.AutomationId=="TaskViewButton") { min=Math.Min(min,r.Left); max=Math.Max(max,r.Right); }
          } catch(Exception) {}
        }
      } catch(Exception) {}
    }
    if(min==double.MaxValue) return new int[]{b.L,b.T,0,0,0,0,0,0,dpi};
    Rect tray; var notify=Child(bar,"TrayNotifyWnd");
    int right=b.R; if(notify!=IntPtr.Zero && GetWindowRect(notify,out tray)) right=tray.L;
    int left=b.L;
    if(widgetRight>0 && widgetLeft<min) left=(int)widgetRight;
    if(widgetRight>0 && widgetLeft>max) right=Math.Min(right,(int)widgetLeft);
    // Other players may already embed their own native lyric HWND. Reserve
    // those rectangles as well rather than covering another app's content.
    var occupied=new List<Rect>(); uint shellProcess; GetWindowThreadProcessId(bar,out shellProcess);
    IntPtr item=IntPtr.Zero;
    while((item=FindWindowEx(bar,item,null,null))!=IntPtr.Zero) {
      uint process; GetWindowThreadProcessId(item,out process);
      Rect r;
      if(item!=child && process!=shellProcess && IsWindowVisible(item) && GetWindowRect(item,out r) && r.B>b.T && r.T<b.B) occupied.Add(r);
    }
    var leftGap=FreeGap(left,(int)min,occupied); var rightGap=FreeGap((int)max,right,occupied);
    return new int[]{b.L,b.T,b.R-b.L,b.B-b.T,leftGap[0]-b.L,leftGap[1],rightGap[0]-b.L,rightGap[1],dpi};
  }
  public static bool ConsumeReattached() { var value=reattached; reattached=false; return value; }
  // SWP_SHOWWINDOW is required after Explorer rebuilds the taskbar. Without
  // it the child can remain hidden even though its parent and bounds are valid.
  public static void Place(int x,int y,int w,int h) { if(IsWindow(child)) SetWindowPos(child,IntPtr.Zero,x,y,w,h,0x0054); }
  public static void Restore() {
    RestoreTaskList();
    if(IsWindow(child)) {
      SetParent(child,IsWindow(originalParent)?originalParent:IntPtr.Zero);
      SetWindowLong(child,-16,originalStyle); SetWindowLong(child,-20,originalExtendedStyle);
      SetWindowPos(child,IntPtr.Zero,0,0,0,0,0x0037);
    }
  }
}
'@
[LinkLineTaskbar]::Init($WindowHandle)
[LinkLineTaskbar]::StartInput()
$settings = @{position='auto';width=400;auto=$true;left=0;right=0}
$last = ''
$lastScan = [DateTime]::MinValue
$place = $null
try {
  while ($true) {
    if (-not (Get-Process -Id $OwnerProcess -ErrorAction SilentlyContinue)) { break }
    $line = [LinkLineTaskbar]::ReadCommand()
    if ($null -ne $line) {
      $message = $line | ConvertFrom-Json
      if ($message.stop) { break }
      if ($message.place) {
        if ($place) { [LinkLineTaskbar]::Place($place[0],0,$place[1],$place[2]) }
      } else {
        foreach($key in @('position','width','auto','left','right')) { if ($null -ne $message.$key) { $settings[$key]=$message.$key } }
        $lastScan = [DateTime]::MinValue
      }
    } elseif ([LinkLineTaskbar]::InputClosed) { break }
    if (([DateTime]::UtcNow-$lastScan).TotalMilliseconds -ge 1200) {
      $lastScan=[DateTime]::UtcNow
      try {
        $s=[LinkLineTaskbar]::Spaces([int]$settings.width)
        $reattached=[LinkLineTaskbar]::ConsumeReattached()
      } catch {
        # UIAutomation and Explorer can invalidate a bridge between the
        # FindWindow and scan calls. Keep the helper alive and retry instead
        # of losing the taskbar lyric window on a transient exception.
        if ($_.Exception.Message -match 'TASKBAR_WINDOW_LOST') { throw }
        $last=''
        Start-Sleep -Milliseconds 250
        continue
      }
      if ($s) {
        $centered=[LinkLineTaskbar]::IsCentered()
        $anchor='right';$x=$s[6];$width=$s[7]
        if (($settings.position -eq 'left' -and $s[5] -gt 0) -or ($settings.position -eq 'auto' -and $centered -and $s[5] -ge $s[7])) { $anchor='left';$x=$s[4];$width=$s[5] }
        $scale=$s[8]/96.0
        $left=[int][Math]::Round($settings.left*$scale);$right=[int][Math]::Round($settings.right*$scale)
        $x += $left
        $width=[Math]::Max(0,$width-$left-$right)
        if (-not $settings.auto) { $w=[Math]::Min($width,[int][Math]::Round($settings.width*$scale)); if($anchor -eq 'right') { $x+=$width-$w }; $width=$w }
        $place=@($x,$width,$s[3])
        $result=@{x=$s[0]+$x;y=$s[1];width=$width;height=$s[3];anchor=$anchor;isLight=[LinkLineTaskbar]::IsLight()} | ConvertTo-Json -Compress
        if($reattached -or $result -ne $last) { [Console]::Out.WriteLine($result);[Console]::Out.Flush();$last=$result }
        if($width -ge 120) { [LinkLineTaskbar]::Place($x,0,$width,$s[3]) }
      }
    }
    Start-Sleep -Milliseconds 100
  }
} finally { [LinkLineTaskbar]::Restore() }
`
