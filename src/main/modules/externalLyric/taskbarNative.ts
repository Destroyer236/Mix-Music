/** Event-driven Windows taskbar hosting using the system .NET/Win32 runtime. */
export const taskbarNativeScript = String.raw`param([long]$WindowHandle, [int]$OwnerProcess)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
$assemblies = @([System.Windows.Automation.AutomationElement].Assembly.Location, [System.Windows.Automation.TreeScope].Assembly.Location, [System.Windows.Rect].Assembly.Location) | Select-Object -Unique
Add-Type -ReferencedAssemblies $assemblies -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.ComponentModel;
using System.Threading;
using System.Runtime.InteropServices;
using System.Windows.Automation;
using Microsoft.Win32;
public static class LinkLineTaskbar {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int L,T,R,B; }
  [StructLayout(LayoutKind.Sequential)] struct Message { public IntPtr hwnd; public uint msg; public UIntPtr w; public IntPtr l; public uint time; public int x,y; public uint reserved; }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct WndClass { public uint size,style; public WndProc proc; public int extra1,extra2; public IntPtr instance,icon,cursor,brush; public string menu,name; public IntPtr smallIcon; }
  [UnmanagedFunctionPointer(CallingConvention.Winapi)] delegate IntPtr WndProc(IntPtr hwnd,uint msg,IntPtr w,IntPtr l);
  [UnmanagedFunctionPointer(CallingConvention.Winapi)] delegate void WinEventProc(IntPtr hook,uint evt,IntPtr hwnd,int obj,int item,uint thread,uint time);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string cls,string title);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
  [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetParent(IntPtr h,IntPtr p);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h,uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetDesktopWindow();
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h,int index);
  [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h,int index,int value);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
  [DllImport("user32.dll")] static extern bool MoveWindow(IntPtr h,int x,int y,int w,int height,bool repaint);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint process);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,System.Text.StringBuilder name,int max);
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min,uint max,IntPtr module,WinEventProc callback,uint process,uint thread,uint flags);
  [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll")] static extern int GetMessage(out Message message,IntPtr h,uint min,uint max);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref Message message);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Message message);
  [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread,uint message,UIntPtr w,IntPtr l);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern uint RegisterWindowMessage(string name);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern ushort RegisterClassEx(ref WndClass cls);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint ex,string cls,string title,uint style,int x,int y,int w,int h,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr param);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr DefWindowProc(IntPtr h,uint msg,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr h);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access,bool inherit,uint process);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr process,uint flags,System.Text.StringBuilder name,ref int size);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode)] static extern int RegOpenKeyEx(UIntPtr root,string sub,uint options,uint access,out IntPtr key);
  [DllImport("advapi32.dll")] static extern int RegNotifyChangeKeyValue(IntPtr key,bool subtree,uint filter,IntPtr eventHandle,bool async);
  [DllImport("advapi32.dll")] static extern int RegCloseKey(IntPtr key);
  const uint WM_QUIT=0x0012,WM_BIND=0x0401;
  const string BridgeClass="Windows.UI.Composition.DesktopWindowContentBridge";
  static readonly WndProc watcherProc=WatcherWindowProc;
  static readonly WinEventProc eventProc=WinEvent;
  static readonly StructureChangedEventHandler structureChanged=delegate(object sender,StructureChangedEventArgs args) { Signal(1); };
  static readonly AutoResetEvent wake=new AutoResetEvent(false);
  static readonly ManualResetEvent watcherStop=new ManualResetEvent(false);
  static readonly ConcurrentQueue<string> commands=new ConcurrentQueue<string>();
  static Thread watcherThread;
  static readonly Thread[] registryThreads=new Thread[2];
  static volatile bool watchersRunning;
  static volatile bool uiaBound;
  static long watcherBindStarted;
  static int pendingSignals;
  static uint watcherThreadId,taskbarCreatedMessage;
  static IntPtr watcherWindow,watchedBar,requestedBar,winEventHook;
  static AutomationElement watchedElement;
  static IntPtr child,bar,list,rebar,originalParent;
  static int originalStyle,originalExtendedStyle,offsetX,offsetY;
  static bool legacy,reattached;
  public static volatile bool InputClosed=false;
  static void DpiAware() {
    try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch(EntryPointNotFoundException) { SetProcessDPIAware(); }
  }
  public static void Init(long handle) {
    DpiAware(); child=new IntPtr(handle); originalParent=GetAncestor(child,1);
    if(originalParent==GetDesktopWindow()) originalParent=IntPtr.Zero;
    originalStyle=GetWindowLong(child,-16); originalExtendedStyle=GetWindowLong(child,-20);
  }
  public static void StartInput() {
    var reader=new Thread(delegate() {
      try { string line; while((line=Console.ReadLine())!=null) { commands.Enqueue(line); wake.Set(); } }
      finally { InputClosed=true; wake.Set(); }
    });
    reader.IsBackground=true; reader.Start();
  }
  public static string ReadCommand() { string line; return commands.TryDequeue(out line)?line:null; }
  public static bool Wait(int milliseconds) { return wake.WaitOne(milliseconds); }
  static void Signal(int flags) {
    if(!watchersRunning) return;
    int oldValue,newValue;
    do { oldValue=pendingSignals; newValue=oldValue|flags; } while(Interlocked.CompareExchange(ref pendingSignals,newValue,oldValue)!=oldValue);
    wake.Set();
  }
  public static int ReadSignal() { return Interlocked.Exchange(ref pendingSignals,0); }
  static IntPtr WatcherWindowProc(IntPtr hwnd,uint msg,IntPtr w,IntPtr l) {
    if(msg==taskbarCreatedMessage && taskbarCreatedMessage!=0) Signal(3);
    return DefWindowProc(hwnd,msg,w,l);
  }
  static void WinEvent(IntPtr hook,uint evt,IntPtr hwnd,int obj,int item,uint thread,uint time) {
    if(hwnd==IntPtr.Zero || obj!=0 || item!=0 || hwnd==child) return;
    if(hwnd==watchedBar) { Signal(evt==0x8001?3:1); return; }
    if(GetParent(hwnd)!=watchedBar) return;
    var name=new System.Text.StringBuilder(128); GetClassName(hwnd,name,name.Capacity);
    string cls=name.ToString();
    if(cls=="TrayNotifyWnd" || cls==BridgeClass || cls=="ReBarWindow32" || cls=="WorkerW") Signal(1);
  }
  static void UnbindWatchers() {
    uiaBound=false;
    if(watchedElement!=null) {
      try { Automation.RemoveStructureChangedEventHandler(watchedElement,structureChanged); } catch(Exception) {}
      watchedElement=null;
    }
    if(winEventHook!=IntPtr.Zero) { UnhookWinEvent(winEventHook); winEventHook=IntPtr.Zero; }
    watchedBar=IntPtr.Zero;
  }
  static void BindWatchers() {
    Interlocked.Exchange(ref watcherBindStarted,DateTime.UtcNow.Ticks);
    try {
      UnbindWatchers();
      var target=requestedBar;
      if(!watchersRunning || !IsWindow(target)) return;
      watchedBar=target;
      uint process; GetWindowThreadProcessId(target,out process);
      // Hook Explorer's window changes without injecting into Explorer.
      winEventHook=SetWinEventHook(0x8000,0x800B,IntPtr.Zero,eventProc,process,0,0);
      try {
        watchedElement=AutomationElement.FromHandle(target);
        Automation.AddStructureChangedEventHandler(watchedElement,TreeScope.Subtree,structureChanged);
        uiaBound=true;
      } catch(Exception) { watchedElement=null; }
      Signal(1);
    } finally { Interlocked.Exchange(ref watcherBindStarted,0); }
  }
  static void WatcherLoop() {
    DpiAware(); watcherThreadId=GetCurrentThreadId();
    taskbarCreatedMessage=RegisterWindowMessage("TaskbarCreated");
    string name="LinkLineTaskbarWatcher_"+System.Diagnostics.Process.GetCurrentProcess().Id;
    var cls=new WndClass(); cls.size=(uint)Marshal.SizeOf(typeof(WndClass)); cls.proc=watcherProc; cls.name=name;
    if(RegisterClassEx(ref cls)==0) { Signal(1); return; }
    // A hidden top-level window receives Explorer's broadcast; a message-only
    // HWND would miss TaskbarCreated entirely.
    watcherWindow=CreateWindowEx(0x08000080,name,"",0,0,0,0,0,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
    try {
      BindWatchers(); Message msg;
      while(watchersRunning && GetMessage(out msg,IntPtr.Zero,0,0)>0) {
        if(msg.msg==WM_BIND) BindWatchers();
        else { TranslateMessage(ref msg); DispatchMessage(ref msg); }
      }
    } finally {
      UnbindWatchers(); if(watcherWindow!=IntPtr.Zero) DestroyWindow(watcherWindow);
      watcherWindow=IntPtr.Zero; watcherThreadId=0;
    }
  }
  static void WatchRegistry(string path) {
    IntPtr key;
    if(RegOpenKeyEx(new UIntPtr(0x80000001),path,0,0x0010,out key)!=0) return;
    using(var changed=new AutoResetEvent(false)) {
      try {
        while(watchersRunning) {
          if(RegNotifyChangeKeyValue(key,false,4,changed.SafeWaitHandle.DangerousGetHandle(),true)!=0) break;
          if(WaitHandle.WaitAny(new WaitHandle[]{changed,watcherStop})!=0) break;
          Signal(1);
        }
      } finally { RegCloseKey(key); }
    }
  }
  public static void StartWatchers() {
    if(watchersRunning) return;
    watchersRunning=true; watcherStop.Reset();
    watcherThread=new Thread(WatcherLoop); watcherThread.SetApartmentState(ApartmentState.MTA); watcherThread.IsBackground=true; watcherThread.Start();
    string[] paths={@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced",@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"};
    for(int i=0;i<paths.Length;i++) {
      string path=paths[i]; var worker=new Thread(delegate() { WatchRegistry(path); });
      worker.IsBackground=true; registryThreads[i]=worker; worker.Start();
    }
  }
  public static void StopWatchers() {
    watchersRunning=false; watcherStop.Set();
    if(watcherThreadId!=0) PostThreadMessage(watcherThreadId,WM_QUIT,UIntPtr.Zero,IntPtr.Zero);
    if(watcherThread!=null) watcherThread.Join(1000);
    foreach(var worker in registryThreads) if(worker!=null) worker.Join(1000);
    ReadSignal();
  }
  static void RequestWatcherBind() {
    requestedBar=bar;
    if(watcherThreadId!=0) PostThreadMessage(watcherThreadId,WM_BIND,UIntPtr.Zero,IntPtr.Zero);
  }
  static IntPtr Child(IntPtr parent,string cls) { return FindWindowEx(parent,IntPtr.Zero,cls,null); }
  static IntPtr FindTaskbar() {
    IntPtr candidate=IntPtr.Zero;
    while((candidate=FindWindowEx(IntPtr.Zero,candidate,"Shell_TrayWnd",null))!=IntPtr.Zero) {
      uint pid; GetWindowThreadProcessId(candidate,out pid);
      var process=OpenProcess(0x1000,false,pid);
      if(process==IntPtr.Zero) continue;
      try {
        var name=new System.Text.StringBuilder(1024); int size=name.Capacity;
        if(QueryFullProcessImageName(process,0,name,ref size) && String.Equals(System.IO.Path.GetFileName(name.ToString()),"explorer.exe",StringComparison.OrdinalIgnoreCase)) return candidate;
      } finally { CloseHandle(process); }
    }
    return IntPtr.Zero;
  }
  public static int Dpi() { try { var d=GetDpiForWindow(bar); return d==0?96:(int)d; } catch(EntryPointNotFoundException) { return 96; } }
  public static bool IsLegacy() { return legacy; }
  static int Reg(string path,string name,int fallback) {
    using(var key=Registry.CurrentUser.OpenSubKey(path)) { var value=key==null?null:key.GetValue(name); return value is int?(int)value:fallback; }
  }
  public static bool IsLight() { return Reg(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize","SystemUsesLightTheme",0)!=0; }
  public static bool IsCentered() { return !legacy && Reg(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced","TaskbarAl",1)!=0; }
  static void RestoreTaskList() {
    if(legacy && IsWindow(list) && IsWindow(rebar)) {
      Rect r; if(GetWindowRect(rebar,out r)) MoveWindow(list,offsetX,offsetY,Math.Max(0,r.R-r.L-offsetX),Math.Max(0,r.B-r.T-offsetY),true);
    }
    legacy=false;
  }
  public static void Reinitialize() { RestoreTaskList(); bar=IntPtr.Zero; }
  public static bool HostChanged() {
    if(!IsWindow(child)) throw new InvalidOperationException("TASKBAR_WINDOW_LOST");
    if(watchersRunning) {
      long started=Interlocked.Read(ref watcherBindStarted);
      if(watcherThread==null || !watcherThread.IsAlive || (started!=0 && DateTime.UtcNow.Ticks-started>TimeSpan.FromSeconds(20).Ticks)) throw new InvalidOperationException("TASKBAR_WATCHER_UNRESPONSIVE");
      // Explorer may expose its HWND before the automation provider is ready.
      // Retry a failed subscription without repeatedly scanning a healthy tree.
      if(!uiaBound && started==0 && IsWindow(bar)) RequestWatcherBind();
    }
    return !IsWindow(bar) || GetAncestor(child,1)!=bar;
  }
  static bool Attach() {
    if(!IsWindow(child)) throw new InvalidOperationException("TASKBAR_WINDOW_LOST");
    var next=FindTaskbar();
    if(next==IntPtr.Zero) { RestoreTaskList(); bar=IntPtr.Zero; return false; }
    if(next==bar && GetAncestor(child,1)==bar) return true;
    RestoreTaskList(); bar=next;
    rebar=Child(bar,"ReBarWindow32"); if(rebar==IntPtr.Zero) rebar=Child(bar,"WorkerW");
    list=rebar==IntPtr.Zero?IntPtr.Zero:Child(rebar,"MSTaskSwWClass");
    if(list==IntPtr.Zero && rebar!=IntPtr.Zero) list=Child(rebar,"MSTaskListWClass");
    legacy=list!=IntPtr.Zero && Child(bar,BridgeClass)==IntPtr.Zero;
    if(legacy) { Rect r,l; GetWindowRect(rebar,out r); GetWindowRect(list,out l); offsetX=l.L-r.L; offsetY=l.T-r.T; }
    // Preserve Electron's popup semantics. Forcing WS_CHILD here makes
    // Chromium's visibility/occlusion tracking disagree with the hosted HWND.
    SetParent(child,bar);
    if(GetAncestor(child,1)!=bar) throw new Win32Exception(Marshal.GetLastWin32Error(),"Could not embed taskbar lyric window");
    SetWindowLong(child,-16,GetWindowLong(child,-16)&~0x00CF0000);
    SetWindowLong(child,-20,GetWindowLong(child,-20)|0x08080080);
    SetWindowPos(child,IntPtr.Zero,0,0,0,0,0x0037);
    reattached=true; RequestWatcherBind(); return true;
  }
  // Physical pixels relative to the taskbar client. Null means unknown, never
  // an instruction to hide; two valid empty rectangles mean genuinely no room.
  public static int[] Spaces(int desiredDip) {
    if(!Attach()) return null;
    Rect b; if(!GetWindowRect(bar,out b)) return null;
    int dpi=Dpi(),height=b.B-b.T;
    int[] result={b.L,b.T,b.R-b.L,height,0,0,0,0,0,0,0,0,dpi};
    if(legacy) {
      Rect r; if(!GetWindowRect(rebar,out r)) return null;
      int desired=(int)Math.Round(desiredDip*dpi/96.0),w=r.R-r.L,h=r.B-r.T;
      bool vertical=h>w;
      int remaining=(vertical?h-offsetY:w-offsetX)-desired-10;
      if(remaining<0) { MoveWindow(list,offsetX,offsetY,Math.Max(0,w-offsetX),Math.Max(0,h-offsetY),true); return result; }
      if(vertical) {
        MoveWindow(list,0,offsetY,w,remaining,true);
        result[8]=r.L-b.L; result[9]=r.T-b.T+offsetY+remaining+10; result[10]=w; result[11]=desired;
      } else {
        MoveWindow(list,offsetX,0,remaining,h,true);
        result[8]=r.L-b.L+offsetX+remaining+10; result[9]=r.T-b.T; result[10]=desired; result[11]=h;
      }
      return result;
    }
    IntPtr bridge=IntPtr.Zero;
    while((bridge=FindWindowEx(bar,bridge,BridgeClass,null))!=IntPtr.Zero) {
      try {
        var root=AutomationElement.FromHandle(bridge);
        var items=root.FindAll(TreeScope.Descendants,Condition.TrueCondition);
        double min=double.MaxValue,max=double.MinValue,widgetLeft=0,widgetRight=0;
        for(int i=0;i<items.Count;i++) {
          try {
            var current=items[i].Current; string id=current.AutomationId,cls=current.ClassName;
            bool content=cls=="Taskbar.TaskListButtonAutomationPeer" || id=="StartButton" || id=="SearchButton" || id=="SearchBoxTextBlock";
            if(!content && id!="WidgetsButton") continue;
            var rect=current.BoundingRectangle;
            if(rect.IsEmpty || rect.Width<=0) continue;
            if(id=="WidgetsButton") { widgetLeft=rect.Left; widgetRight=rect.Right; }
            else { min=Math.Min(min,rect.Left); max=Math.Max(max,rect.Right); }
          } catch(Exception) { /* A stale unrelated node must not invalidate a good bridge. */ }
        }
        if(min==double.MaxValue) continue;
        Rect tray; int right=b.R; var notify=Child(bar,"TrayNotifyWnd");
        if(notify!=IntPtr.Zero && GetWindowRect(notify,out tray) && tray.R>tray.L) right=tray.L;
        int left=widgetRight>0 && widgetLeft<min?(int)widgetRight:b.L;
        if(widgetRight>0 && widgetLeft>max) right=(int)widgetLeft;
        result[4]=left-b.L; result[6]=Math.Max(0,(int)min-left); result[7]=height;
        result[8]=(int)max-b.L; result[10]=Math.Max(0,right-(int)max); result[11]=height;
        return result;
      } catch(Exception) { /* Explorer may be replacing this bridge; try the next. */ }
    }
    return null;
  }
  public static bool ConsumeReattached() { bool value=reattached; reattached=false; return value; }
  public static void Restore() {
    // Restore Explorer before waiting for UIA teardown, which can stall in COM.
    // The parent process has a bounded shutdown deadline for this helper.
    watchersRunning=false; watcherStop.Set(); RestoreTaskList();
    if(IsWindow(child)) {
      SetParent(child,IsWindow(originalParent)?originalParent:IntPtr.Zero);
      SetWindowLong(child,-16,originalStyle); SetWindowLong(child,-20,originalExtendedStyle);
      SetWindowPos(child,IntPtr.Zero,0,0,0,0,0x0037);
    }
    StopWatchers();
  }
}
'@
[LinkLineTaskbar]::Init($WindowHandle)
[LinkLineTaskbar]::StartInput()
[LinkLineTaskbar]::StartWatchers()
$width = 400
$dirty = $true
$due = [DateTime]::UtcNow
$retry = 0
$delays = @(50,150,300,600)
$heartbeat = [DateTime]::UtcNow
$integrity = [DateTime]::UtcNow
$stopping = $false
try {
  while (-not $stopping) {
    while ($null -ne ($line = [LinkLineTaskbar]::ReadCommand())) {
      $message = $line | ConvertFrom-Json
      if ($message.stop) { $stopping=$true; break }
      if ($null -ne $message.width) { $width=[Math]::Max(120,[int]$message.width) }
      $dirty=$true; $retry=0; $due=[DateTime]::UtcNow
    }
    if ($stopping -or [LinkLineTaskbar]::InputClosed) { break }
    $now=[DateTime]::UtcNow
    $signals=[LinkLineTaskbar]::ReadSignal()
    if (($signals -band 2) -ne 0) {
      [LinkLineTaskbar]::Reinitialize(); $dirty=$true; $retry=0; $due=$now.AddMilliseconds(150)
    } elseif ($signals -ne 0 -and -not $dirty) {
      # Bound the coalescing window so continuous taskbar animations cannot
      # postpone a pending scan forever or reset its cold-start retry budget.
      $dirty=$true; $retry=0; $due=$now.AddMilliseconds(150)
    }
    # A cheap HWND check and service-thread heartbeat cover missed broadcasts
    # and blocked UIA calls without continuously rescanning Explorer's tree.
    if (($now-$integrity).TotalSeconds -ge 5) {
      $integrity=$now
      if (-not (Get-Process -Id $OwnerProcess -ErrorAction SilentlyContinue)) { break }
      if ([LinkLineTaskbar]::HostChanged()) { $dirty=$true; $retry=0; $due=$now }
    }
    if ($dirty -and $now -ge $due) {
      try { $s=[LinkLineTaskbar]::Spaces($width) }
      catch {
        if ($_.Exception.Message -match 'TASKBAR_WINDOW_LOST') { throw }
        $s=$null
      }
      if ($s) {
        $left=@{x=$s[4];y=$s[5];width=$s[6];height=$s[7]}
        $right=@{x=$s[8];y=$s[9];width=$s[10];height=$s[11]}
        $systemType=if([LinkLineTaskbar]::IsLegacy()) {'win10'} else {'win11'}
        $extra=@{isCentered=[LinkLineTaskbar]::IsCentered();isLight=[LinkLineTaskbar]::IsLight();systemType=$systemType;scale=$s[12]/96.0;taskbarX=$s[0];taskbarY=$s[1];reattached=[LinkLineTaskbar]::ConsumeReattached()}
        [Console]::Out.WriteLine((@{space=@{left=$left;right=$right};extra=$extra} | ConvertTo-Json -Depth 4 -Compress))
        [Console]::Out.Flush()
        $dirty=$false; $retry=0
      } elseif ($retry -lt $delays.Length) {
        $due=[DateTime]::UtcNow.AddMilliseconds($delays[$retry]); $retry++
      } else { $dirty=$false }
    }
    $now=[DateTime]::UtcNow
    if (($now-$heartbeat).TotalSeconds -ge 5) {
      [Console]::Out.WriteLine('{"heartbeat":true}'); [Console]::Out.Flush(); $heartbeat=$now
    }
    $wait=1000
    if ($dirty) { $wait=[Math]::Max(0,[Math]::Min($wait,($due-$now).TotalMilliseconds)) }
    [LinkLineTaskbar]::Wait([int]$wait) | Out-Null
  }
} finally { [LinkLineTaskbar]::Restore() }
`
