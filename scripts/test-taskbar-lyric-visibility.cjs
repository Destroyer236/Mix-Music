const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const Module = require('node:module')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const filename = path.resolve(__dirname, '../src/main/modules/externalLyric/taskbarNative.ts')
const subject = new Module(filename, module)
subject._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, filename)
const entry = '[LinkLineTaskbar]::Init($WindowHandle)'
const boundary = subject.exports.taskbarNativeScript.indexOf(entry)
assert.ok(boundary > 0, 'The production helper must expose its native initialization entry')

// Every shell class is replaced before compiling. The fixture cannot find,
// resize, reparent into, or change the Z order of the real Explorer taskbar.
const prefix = `LinkLineInvisibleFixture${process.pid}_`
const classNames = [
  'Shell_TrayWnd', 'ReBarWindow32', 'WorkerW', 'MSTaskSwWClass',
  'MSTaskListWClass', 'Windows.UI.Composition.DesktopWindowContentBridge', 'TrayNotifyWnd',
]
const registryRoot = `Software\\LinkLineNativeRegression\\Run${process.pid}`
let native = subject.exports.taskbarNativeScript.slice(0, boundary)
for (const name of classNames) native = native.replaceAll(name, prefix + name)
native = native.replaceAll('Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', registryRoot + '\\Advanced')
  .replaceAll('Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', registryRoot + '\\Personalize')
const explorerOwnedNative = native
native = native.replaceAll('"explorer.exe"', '"powershell.exe"')
const loop = subject.exports.taskbarNativeScript.slice(boundary).replaceAll('[LinkLineTaskbar]', '[TaskbarLoopFixture]')

// Keep the HWNDs on a private thread with a message pump so UIAutomation can
// query the empty fixture bridge. No fixture is created with WS_VISIBLE.
const fixture = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
public static class NativeVisibilityFixture {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int L,T,R,B; }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct WClass {
    public uint style; public IntPtr proc; public int classExtra,windowExtra;
    public IntPtr instance,icon,cursor,background; public string menu,name;
  }
  [StructLayout(LayoutKind.Sequential)] struct Message {
    public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam;
    public uint time; public int x,y; public uint extra;
  }
  delegate IntPtr WProc(IntPtr h,uint m,IntPtr w,IntPtr l);
  static readonly WProc proc=DefWindowProc;
  static readonly ConcurrentQueue<Action> jobs=new ConcurrentQueue<Action>();
  static readonly List<IntPtr> windows=new List<IntPtr>();
  static readonly ManualResetEvent ready=new ManualResetEvent(false);
  static readonly ManualResetEvent watcherHeld=new ManualResetEvent(false),watcherRelease=new ManualResetEvent(false),restoreDone=new ManualResetEvent(false);
  static readonly WProc heldProc=HoldWindowProc;
  static IntPtr oldWatcherProc;
  static Exception restoreError;
  static Thread thread; static uint threadId;
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern ushort RegisterClass(ref WClass c);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint ex,string c,string t,uint s,int x,int y,int w,int h,IntPtr p,IntPtr menu,IntPtr instance,IntPtr param);
  [DllImport("user32.dll")] static extern IntPtr DefWindowProc(IntPtr h,uint m,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h,int x,int y,int w,int z,bool repaint);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll",SetLastError=true)] public static extern IntPtr SetParent(IntPtr h,IntPtr p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h,uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetDesktopWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h,uint command);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h,int n);
  [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h,int n,int value);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int command);
  [DllImport("user32.dll")] static extern int GetMessage(out Message message,IntPtr h,uint min,uint max);
  [DllImport("user32.dll")] static extern bool PeekMessage(out Message message,IntPtr h,uint min,uint max,uint remove);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref Message message);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Message message);
  [DllImport("user32.dll")] static extern bool PostThreadMessage(uint id,uint message,UIntPtr w,IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint process);
  [DllImport("user32.dll")] static extern void PostQuitMessage(int code);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern void NotifyWinEvent(uint evt,IntPtr h,int obj,int child);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls,string name);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern uint RegisterWindowMessage(string name);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h,uint message,IntPtr w,IntPtr l);
  [DllImport("user32.dll",EntryPoint="SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr h,int index,IntPtr value);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CallWindowProc(IntPtr proc,IntPtr h,uint message,IntPtr w,IntPtr l);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool PostMessage(IntPtr h,uint message,IntPtr w,IntPtr l);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  static void Run(Action action) {
    Exception error=null;
    using(var complete=new ManualResetEvent(false)) {
      jobs.Enqueue(delegate { try { action(); } catch(Exception e) { error=e; } finally { complete.Set(); } });
      if(!PostThreadMessage(threadId,0x8000,UIntPtr.Zero,IntPtr.Zero) || !complete.WaitOne(10000)) throw new Exception("Fixture thread did not respond");
    }
    if(error!=null) throw new Exception("Fixture operation failed",error);
  }
  public static void Start() {
    thread=new Thread(delegate() {
      SetThreadDpiAwarenessContext(new IntPtr(-4));
      threadId=GetCurrentThreadId(); Message message; PeekMessage(out message,IntPtr.Zero,0,0,0); ready.Set();
      while(GetMessage(out message,IntPtr.Zero,0,0)>0) {
        if(message.message==0x8000) { Action job; while(jobs.TryDequeue(out job)) job(); }
        else { TranslateMessage(ref message); DispatchMessage(ref message); }
      }
    });
    thread.IsBackground=true; thread.SetApartmentState(ApartmentState.STA); thread.Start();
    if(!ready.WaitOne(10000)) throw new Exception("Fixture thread did not initialize");
  }
  public static IntPtr Window(string name,IntPtr parent,int x,int y,int w,int h) {
    IntPtr result=IntPtr.Zero;
    Run(delegate {
      var c=new WClass(); c.name=name; c.proc=Marshal.GetFunctionPointerForDelegate(proc); RegisterClass(ref c);
      result=CreateWindowEx(0,name,"",parent==IntPtr.Zero?0x80000000u:0x40000000u,x,y,w,h,parent,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
      if(result==IntPtr.Zero) throw new Exception("Fixture window creation failed"); windows.Add(result);
    });
    return result;
  }
  public static void Close(IntPtr h) { Run(delegate { if(IsWindow(h)) DestroyWindow(h); }); }
  public static void Decorate(IntPtr h) { Run(delegate { SetWindowLong(h,-16,unchecked((int)0x80CF0000)); SetWindowLong(h,-20,0x00040000); }); }
  public static void Notify(IntPtr h,uint evt) { Run(delegate { NotifyWinEvent(evt,h,0,0); }); }
  public static void Reparent(IntPtr h,IntPtr p) { Run(delegate { SetParent(h,p); }); }
  public static IntPtr PhysicalParent(IntPtr h) { var parent=GetAncestor(h,1); return parent==GetDesktopWindow()?IntPtr.Zero:parent; }
  static IntPtr HoldWindowProc(IntPtr h,uint message,IntPtr w,IntPtr l) {
    if(message==0x8201) { watcherHeld.Set(); watcherRelease.WaitOne(10000); return IntPtr.Zero; }
    return CallWindowProc(oldWatcherProc,h,message,w,l);
  }
  public static void HoldWatcher(IntPtr h) {
    var pointer=Marshal.GetFunctionPointerForDelegate(heldProc);
    oldWatcherProc=IntPtr.Size==8?SetWindowLongPtr(h,-4,pointer):new IntPtr(SetWindowLong(h,-4,pointer.ToInt32()));
    if(oldWatcherProc==IntPtr.Zero || !PostMessage(h,0x8201,IntPtr.Zero,IntPtr.Zero) || !watcherHeld.WaitOne(5000)) throw new Exception("Could not hold the private watcher callback");
  }
  public static void ReleaseWatcher() { watcherRelease.Set(); }
  public static void QuitWatcher(IntPtr h) {
    uint process; uint id=GetWindowThreadProcessId(h,out process);
    if(id==0 || !PostThreadMessage(id,0x0012,UIntPtr.Zero,IntPtr.Zero)) throw new Exception("Could not stop the private watcher thread");
    var deadline=DateTime.UtcNow.AddSeconds(5);
    while(IsWindow(h) && DateTime.UtcNow<deadline) Thread.Sleep(10);
    if(IsWindow(h)) throw new Exception("Private watcher did not stop");
  }
  public static void BeginRestore(Type native) {
    var worker=new Thread(delegate() { try { native.GetMethod("Restore").Invoke(null,null); } catch(Exception e) { restoreError=e; } finally { restoreDone.Set(); } });
    worker.IsBackground=true; worker.Start();
  }
  public static void FinishRestore() {
    watcherRelease.Set();
    if(!restoreDone.WaitOne(10000)) throw new Exception("Native restore did not finish");
    if(restoreError!=null) throw new Exception("Native restore failed",restoreError);
  }
  public static void Dispose() {
    if(thread==null) return;
    Run(delegate { for(int i=windows.Count-1;i>=0;i--) if(IsWindow(windows[i])) DestroyWindow(windows[i]); windows.Clear(); PostQuitMessage(0); });
    if(!thread.Join(10000)) throw new Exception("Fixture thread did not stop");
    thread=null;
  }
}
'@
function Assert-True($value,$message) { if(-not $value) { throw $message } }
function Wait-Signal([int]$expected,[int]$timeout=5000) {
  $end=[DateTime]::UtcNow.AddMilliseconds($timeout)
  $received=0
  do {
    $received=$received -bor [LinkLineTaskbar]::ReadSignal()
    if (($received -band $expected) -eq $expected) { return $received }
    [LinkLineTaskbar]::Wait(50) | Out-Null
  } while ([DateTime]::UtcNow -lt $end)
  throw "Expected native signal $expected, received $received"
}
function Drain-Signals {
  $end=[DateTime]::UtcNow.AddMilliseconds(350)
  while ([DateTime]::UtcNow -lt $end) { [LinkLineTaskbar]::ReadSignal() | Out-Null; [LinkLineTaskbar]::Wait(25) | Out-Null }
  [LinkLineTaskbar]::ReadSignal() | Out-Null
}
[NativeVisibilityFixture]::Start()
`

const loopFixture = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TaskbarLoopFixture {
  static IntPtr child; static int scans; static bool invalidated;
  static readonly System.Diagnostics.Stopwatch elapsed=new System.Diagnostics.Stopwatch();
  public static Type Native;
  public static bool AlwaysSignals=false;
  public static int MaxScans=3,UnknownScan=2,DeadlineMilliseconds=5000;
  public static long ElapsedMilliseconds { get { return elapsed.ElapsedMilliseconds; } }
  [DllImport("user32.dll")] static extern IntPtr SetParent(IntPtr h,IntPtr p);
  static object Call(string name,params object[] args) { return Native.GetMethod(name).Invoke(null,args); }
  public static bool InputClosed=false;
  public static void Init(long handle) { child=new IntPtr(handle); Call("Init",handle); elapsed.Start(); }
  public static void StartInput() {}
  public static void StartWatchers() {}
  public static bool Wait(int ms) { System.Threading.Thread.Sleep(Math.Min(ms,20)); return false; }
  public static string ReadCommand() { return scans>=MaxScans || elapsed.ElapsedMilliseconds>=DeadlineMilliseconds?"{\"stop\":true}":null; }
  public static int ReadSignal() {
    if(AlwaysSignals) return 1;
    if(scans==1 && !invalidated) { invalidated=true; return 1; }
    return 0;
  }
  public static int[] Spaces(int width) {
    scans++;
    if(scans==UnknownScan) SetParent(child,IntPtr.Zero);
    var spaces=(int[])Call("Spaces",width);
    return scans==UnknownScan?null:spaces;
  }
  public static bool ConsumeReattached() { return (bool)Call("ConsumeReattached"); }
  public static bool IsLegacy() { return (bool)Call("IsLegacy"); }
  public static bool IsCentered() { return false; }
  public static bool IsLight() { return false; }
  public static bool HostChanged() { return (bool)Call("HostChanged"); }
  public static void Reinitialize() { Call("Reinitialize"); }
  public static void Restore() { Call("Restore"); }
}
'@
[TaskbarLoopFixture]::Native=[LinkLineTaskbar]
`

const runFixture = (body, requireExplorer = false) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'linkline-taskbar-visibility-'))
  const script = path.join(directory, 'fixture.ps1')
  try {
    fs.writeFileSync(script, '\ufeff' + (requireExplorer ? explorerOwnedNative : native) + fixture + body)
    const output = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      windowsHide: true,
      timeout: 60000,
      encoding: 'utf8',
    })
    return output.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('a counterfeit taskbar class from another process is rejected by Explorer ownership validation', { skip: process.platform !== 'win32', timeout: 65000 }, () => {
  const result = runFixture(String.raw`
try {
  $child=[NativeVisibilityFixture]::Window('${prefix}Child',[IntPtr]::Zero,0,0,600,64)
  $bar=[NativeVisibilityFixture]::Window('${prefix}Shell_TrayWnd',[IntPtr]::Zero,0,0,1920,64)
  $rebar=[NativeVisibilityFixture]::Window('${prefix}ReBarWindow32',$bar,0,0,1800,64)
  $list=[NativeVisibilityFixture]::Window('${prefix}MSTaskSwWClass',$rebar,80,0,1720,64)
  [LinkLineTaskbar]::Init($child.ToInt64())
  Assert-True ($null -eq [LinkLineTaskbar]::Spaces(400)) 'A matching window class owned by PowerShell must not impersonate Explorer'
  Assert-True ([NativeVisibilityFixture]::PhysicalParent($child) -eq [IntPtr]::Zero) 'A rejected taskbar must not change the lyric parent'
  $rectangle=New-Object NativeVisibilityFixture+Rect
  [NativeVisibilityFixture]::GetWindowRect($list,[ref]$rectangle) | Out-Null
  Assert-True (($rectangle.R-$rectangle.L) -eq 1720) 'A rejected taskbar must not resize any task buttons'
  @{ownerValidated=$true} | ConvertTo-Json -Compress
} finally { [LinkLineTaskbar]::Restore(); [NativeVisibilityFixture]::Dispose() }
`, true)
  assert.deepEqual(result, [{ ownerValidated: true }])
})

test('native taskbar preserves popup semantics while an empty UIAutomation tree remains unknown', { skip: process.platform !== 'win32', timeout: 65000 }, () => {
  const result = runFixture(String.raw`
try {
  $child=[NativeVisibilityFixture]::Window('${prefix}Child',[IntPtr]::Zero,0,0,600,64)
  [NativeVisibilityFixture]::Decorate($child)
  $style=[NativeVisibilityFixture]::GetWindowLong($child,-16)
  $extendedStyle=[NativeVisibilityFixture]::GetWindowLong($child,-20)
  [LinkLineTaskbar]::Init($child.ToInt64())
  $absent=[LinkLineTaskbar]::Spaces(400)
  Assert-True ($null -eq $absent) 'An absent taskbar is unknown, not a measured zero-width layout'

  $bar=[NativeVisibilityFixture]::Window('${prefix}Shell_TrayWnd',[IntPtr]::Zero,0,0,1920,64)
  $bridge=[NativeVisibilityFixture]::Window('${prefix}Windows.UI.Composition.DesktopWindowContentBridge',$bar,0,0,1800,64)
  $foreground=[NativeVisibilityFixture]::GetForegroundWindow()
  $unknown=[LinkLineTaskbar]::Spaces(400)
  Assert-True ($null -eq $unknown) 'An empty UIAutomation tree is unknown, not a measured zero-width layout'
  Assert-True ([NativeVisibilityFixture]::PhysicalParent($child) -eq $bar) 'The lyric must attach even while automation is temporarily empty'
  $embeddedStyle=[NativeVisibilityFixture]::GetWindowLong($child,-16)
  Assert-True (($embeddedStyle -band [int]::MinValue) -ne 0) 'Embedding must preserve the Electron WS_POPUP style'
  Assert-True (($embeddedStyle -band 0x40000000) -eq 0) 'Embedding must not force WS_CHILD and confuse Chromium visibility tracking'
  Assert-True (($embeddedStyle -band 0x00CF0000) -eq 0) 'Embedding must remove the popup decorations'
  Assert-True (([NativeVisibilityFixture]::GetWindowLong($child,-20) -band 0x08080080) -eq 0x08080080) 'Embedding must retain layered, toolwindow, and no-activate behavior'
  Assert-True ([NativeVisibilityFixture]::GetForegroundWindow() -eq $foreground) 'Embedding must preserve the foreground application'
  Assert-True (-not [LinkLineTaskbar]::IsLegacy()) 'A composition bridge must select modern taskbar layout'
  Assert-True ([LinkLineTaskbar]::ConsumeReattached()) 'An unknown layout must retain its native reattachment notification'
  Assert-True (-not [LinkLineTaskbar]::ConsumeReattached()) 'The native reattachment notification must be consumed once'
  [LinkLineTaskbar]::Restore()
  Assert-True ([NativeVisibilityFixture]::PhysicalParent($child) -eq [IntPtr]::Zero) 'The unknown-layout child must restore before its fixture bar closes'
  Assert-True ([NativeVisibilityFixture]::GetWindowLong($child,-16) -eq $style) 'Restore must recover the original popup style'
  Assert-True ([NativeVisibilityFixture]::GetWindowLong($child,-20) -eq $extendedStyle) 'Restore must recover the original extended style'
  [NativeVisibilityFixture]::Close($bar)
  Assert-True ([NativeVisibilityFixture]::IsWindow($child)) 'Closing the restored fixture bar must preserve the source child'
  @{unknownLayout=$true;popupPreserved=$true;sourceRestored=$true} | ConvertTo-Json -Compress
} finally {
  [LinkLineTaskbar]::Restore()
  [NativeVisibilityFixture]::Dispose()
}
`)
  assert.deepEqual(result, [{ unknownLayout: true, popupPreserved: true, sourceRestored: true }])
})

test('legacy native layout reserves physical client rectangles and restores after reattachment and resize', { skip: process.platform !== 'win32', timeout: 65000 }, () => {
  const result = runFixture(String.raw`
try {
  $owner=[NativeVisibilityFixture]::Window('${prefix}Owner',[IntPtr]::Zero,0,0,100,64)
  $child=[NativeVisibilityFixture]::Window('${prefix}Child',[IntPtr]::Zero,0,0,600,64)
  [NativeVisibilityFixture]::Decorate($child)
  [NativeVisibilityFixture]::Reparent($child,$owner)
  $style=[NativeVisibilityFixture]::GetWindowLong($child,-16)
  $extendedStyle=[NativeVisibilityFixture]::GetWindowLong($child,-20)
  $bar=[NativeVisibilityFixture]::Window('${prefix}Shell_TrayWnd',[IntPtr]::Zero,-2400,900,1920,64)
  $rebar=[NativeVisibilityFixture]::Window('${prefix}ReBarWindow32',$bar,20,0,1800,64)
  $list=[NativeVisibilityFixture]::Window('${prefix}MSTaskSwWClass',$rebar,80,0,1720,64)
  [LinkLineTaskbar]::Init($child.ToInt64())
  $spaces=[LinkLineTaskbar]::Spaces(400)
  Assert-True ([LinkLineTaskbar]::IsLegacy()) 'A native rebar/tasklist must select legacy taskbar layout'
  Assert-True ($spaces.Length -eq 13) 'The native layout must expose explicit left and right physical rectangles with DPI'
  Assert-True ([NativeVisibilityFixture]::PhysicalParent($child) -eq $bar) 'The popup must embed into the fixture taskbar'
  Assert-True (($spaces[0] -eq -2400) -and ($spaces[1] -eq 900)) 'Negative monitor origin must remain separate from client coordinates'
  $reserved=[int][Math]::Round(400*$spaces[12]/96.0)
  Assert-True (($spaces[10] -eq $reserved) -and ($spaces[11] -eq 64)) 'The legacy layout must convert configured DIP width to physical pixels'
  Assert-True (($spaces[8] -eq (1820-$reserved)) -and ($spaces[9] -eq 0)) 'The lyric rectangle must be relative to the taskbar client, not the screen'
  Assert-True (($spaces[6] -eq 0) -and ($spaces[7] -eq 0)) 'Legacy reservation must expose the available right rectangle only'
  $rectangle=New-Object NativeVisibilityFixture+Rect
  [NativeVisibilityFixture]::GetWindowRect($list,[ref]$rectangle) | Out-Null
  Assert-True (($rectangle.R-$rectangle.L) -eq (1720-$reserved-10)) 'The legacy task list must reserve the lyric width plus the upstream gap'
  Assert-True ([LinkLineTaskbar]::ConsumeReattached()) 'Initial attachment must notify the Electron owner'
  [NativeVisibilityFixture]::Reparent($child,$owner)
  Assert-True ([LinkLineTaskbar]::HostChanged()) 'A detached lyric must trigger host integrity recovery'
  $again=[LinkLineTaskbar]::Spaces(400)
  Assert-True ([NativeVisibilityFixture]::PhysicalParent($child) -eq $bar) 'A detached popup must reattach to the taskbar'
  Assert-True ([LinkLineTaskbar]::ConsumeReattached()) 'Reattachment must notify even when geometry is unchanged'
  Assert-True (-not [LinkLineTaskbar]::ConsumeReattached()) 'Reattachment must be consumed once'
  $embeddedStyle=[NativeVisibilityFixture]::GetWindowLong($child,-16)
  Assert-True (($embeddedStyle -band [int]::MinValue) -ne 0 -and ($embeddedStyle -band 0x40000000) -eq 0) 'Reattachment must preserve popup semantics without forcing child style'

  [NativeVisibilityFixture]::MoveWindow($rebar,20,0,1900,64,$true) | Out-Null
  [LinkLineTaskbar]::Reinitialize()
  [NativeVisibilityFixture]::GetWindowRect($list,[ref]$rectangle) | Out-Null
  Assert-True (($rectangle.R-$rectangle.L) -eq 1820) 'Reinitializing must release the old reservation after a concurrent taskbar resize'
  [LinkLineTaskbar]::Spaces(400) | Out-Null
  [LinkLineTaskbar]::Restore()
  [NativeVisibilityFixture]::GetWindowRect($list,[ref]$rectangle) | Out-Null
  Assert-True (($rectangle.R-$rectangle.L) -eq 1820) 'Closing lyrics must restore the task list and preserve a concurrent taskbar resize'
  Assert-True ([NativeVisibilityFixture]::PhysicalParent($child) -eq $owner) 'Closing lyrics must restore the original physical parent'
  Assert-True ([NativeVisibilityFixture]::GetWindowLong($child,-16) -eq $style) 'Closing lyrics must restore the original window style'
  Assert-True ([NativeVisibilityFixture]::GetWindowLong($child,-20) -eq $extendedStyle) 'Closing lyrics must restore the original extended window style'
  Assert-True (-not [NativeVisibilityFixture]::IsWindowVisible($bar)) 'The fixture taskbar must remain invisible'

  [LinkLineTaskbar]::Spaces(400) | Out-Null
  [NativeVisibilityFixture]::Close($bar)
  $lost=$false
  try { [LinkLineTaskbar]::Spaces(400) | Out-Null } catch { $lost=$_.Exception.Message.Contains('TASKBAR_WINDOW_LOST') }
  Assert-True $lost 'A destroyed native child must report loss so its Electron owner can recreate it'
  @{popupReattached=$true;physicalClientLayout=$true;legacyRestore=$true;windowLoss=$true} | ConvertTo-Json -Compress
} finally {
  [LinkLineTaskbar]::Restore()
  [NativeVisibilityFixture]::Dispose()
}
`)
  assert.deepEqual(result, [{ popupReattached: true, physicalClientLayout: true, legacyRestore: true, windowLoss: true }])
})

test('legacy native layout supports a vertical taskbar and genuine lack of room', { skip: process.platform !== 'win32', timeout: 65000 }, () => {
  const result = runFixture(String.raw`
try {
  $child=[NativeVisibilityFixture]::Window('${prefix}Child',[IntPtr]::Zero,0,0,600,64)
  $bar=[NativeVisibilityFixture]::Window('${prefix}Shell_TrayWnd',[IntPtr]::Zero,0,0,64,1600)
  $rebar=[NativeVisibilityFixture]::Window('${prefix}ReBarWindow32',$bar,0,20,64,1500)
  $list=[NativeVisibilityFixture]::Window('${prefix}MSTaskSwWClass',$rebar,0,80,64,1420)
  [LinkLineTaskbar]::Init($child.ToInt64())
  $spaces=[LinkLineTaskbar]::Spaces(400)
  $reserved=[int][Math]::Round(400*$spaces[12]/96.0)
  Assert-True (($spaces[8] -eq 0) -and ($spaces[9] -eq (1520-$reserved)) -and ($spaces[10] -eq 64) -and ($spaces[11] -eq $reserved)) 'A vertical taskbar must reserve the lower client rectangle'
  $rectangle=New-Object NativeVisibilityFixture+Rect
  [NativeVisibilityFixture]::GetWindowRect($list,[ref]$rectangle) | Out-Null
  Assert-True (($rectangle.B-$rectangle.T) -eq (1420-$reserved-10)) 'A vertical taskbar must release the reserved physical height'
  $full=[LinkLineTaskbar]::Spaces(4000)
  Assert-True ($null -ne $full -and $full[6] -eq 0 -and $full[7] -eq 0 -and $full[10] -eq 0 -and $full[11] -eq 0) 'A measured lack of room must expose valid empty rectangles, distinct from unknown UIAutomation'
  [NativeVisibilityFixture]::GetWindowRect($list,[ref]$rectangle) | Out-Null
  Assert-True (($rectangle.B-$rectangle.T) -eq 1420) 'A lack of lyric space must restore usable task buttons instead of collapsing them'
  [LinkLineTaskbar]::Restore()
  @{vertical=$true;noRoom=$true} | ConvertTo-Json -Compress
} finally { [LinkLineTaskbar]::Restore(); [NativeVisibilityFixture]::Dispose() }
`)
  assert.deepEqual(result, [{ vertical: true, noRoom: true }])
})

test('the production loop retains reattachment through an unknown scan and emits unchanged layout', { skip: process.platform !== 'win32', timeout: 65000 }, () => {
  const messages = runFixture(String.raw`
${loopFixture}
try {
  $child=[NativeVisibilityFixture]::Window('${prefix}Child',[IntPtr]::Zero,0,0,600,64)
  $bar=[NativeVisibilityFixture]::Window('${prefix}Shell_TrayWnd',[IntPtr]::Zero,0,0,1920,64)
  $rebar=[NativeVisibilityFixture]::Window('${prefix}ReBarWindow32',$bar,0,0,1800,64)
  $list=[NativeVisibilityFixture]::Window('${prefix}MSTaskSwWClass',$rebar,80,0,1720,64)
  $WindowHandle=$child.ToInt64()
  $OwnerProcess=$PID
${loop}
  Assert-True ([NativeVisibilityFixture]::PhysicalParent($child) -eq [IntPtr]::Zero) 'The production loop must restore the popup when it stops'
} finally { [NativeVisibilityFixture]::Dispose() }
`)
  const layouts = messages.filter(message => !message.heartbeat)
  assert.equal(layouts.length, 2, 'An unknown scan must not emit an empty layout or suppress the next real layout')
  assert.deepEqual(layouts[1].space, layouts[0].space, 'The fixture must reproduce unchanged physical coordinates')
  assert.equal(layouts[0].extra.reattached, true)
  assert.equal(layouts[1].extra.reattached, true, 'The retry must preserve the unconsumed reattachment notification')
  assert.equal(layouts[1].extra.systemType, 'win10')
})

test('continuous native layout events cannot postpone a pending production scan', { skip: process.platform !== 'win32', timeout: 65000 }, () => {
  const messages = runFixture(String.raw`
${loopFixture}
[TaskbarLoopFixture]::AlwaysSignals=$true
[TaskbarLoopFixture]::MaxScans=2
[TaskbarLoopFixture]::UnknownScan=0
[TaskbarLoopFixture]::DeadlineMilliseconds=1000
try {
  $child=[NativeVisibilityFixture]::Window('${prefix}Child',[IntPtr]::Zero,0,0,600,64)
  $bar=[NativeVisibilityFixture]::Window('${prefix}Shell_TrayWnd',[IntPtr]::Zero,0,0,1920,64)
  $rebar=[NativeVisibilityFixture]::Window('${prefix}ReBarWindow32',$bar,0,0,1800,64)
  $list=[NativeVisibilityFixture]::Window('${prefix}MSTaskSwWClass',$rebar,80,0,1720,64)
  $WindowHandle=$child.ToInt64()
  $OwnerProcess=$PID
${loop}
  @{elapsed=[TaskbarLoopFixture]::ElapsedMilliseconds} | ConvertTo-Json -Compress
} finally { [NativeVisibilityFixture]::Dispose() }
`)
  const layouts = messages.filter(message => message.space)
  const timing = messages.find(message => Number.isFinite(message.elapsed))
  assert.equal(layouts.length, 2, 'A signal on every loop iteration must still allow the first and subsequent scans to complete')
  assert.ok(timing.elapsed <= 1000, 'Continuous layout events must produce the pending result within one second')
  assert.deepEqual(layouts[1].space, layouts[0].space)
})

test('native watchers wake on taskbar, tray, registry, and recreation events and stop cleanly', { skip: process.platform !== 'win32', timeout: 65000 }, () => {
  const result = runFixture(String.raw`
$registry=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('${registryRoot}')
$advanced=$registry.CreateSubKey('Advanced')
$personalize=$registry.CreateSubKey('Personalize')
try {
  $child=[NativeVisibilityFixture]::Window('${prefix}Child',[IntPtr]::Zero,0,0,600,64)
  $bar=[NativeVisibilityFixture]::Window('${prefix}Shell_TrayWnd',[IntPtr]::Zero,0,0,1920,64)
  $rebar=[NativeVisibilityFixture]::Window('${prefix}ReBarWindow32',$bar,0,0,1800,64)
  $list=[NativeVisibilityFixture]::Window('${prefix}MSTaskSwWClass',$rebar,80,0,1720,64)
  $tray=[NativeVisibilityFixture]::Window('${prefix}TrayNotifyWnd',$bar,1800,0,120,64)
  [LinkLineTaskbar]::Init($child.ToInt64())
  [LinkLineTaskbar]::Spaces(400) | Out-Null
  [LinkLineTaskbar]::StartWatchers()
  Wait-Signal 1 | Out-Null
  Drain-Signals
  [NativeVisibilityFixture]::Notify($tray,0x800B)
  Assert-True ([LinkLineTaskbar]::Wait(5000)) 'A tray event must wake the native command loop'
  Wait-Signal 1 | Out-Null
  Drain-Signals
  [NativeVisibilityFixture]::Notify($bar,0x800B)
  Wait-Signal 1 | Out-Null
  Drain-Signals
  $advanced.SetValue('TaskbarAl',1,[Microsoft.Win32.RegistryValueKind]::DWord)
  Wait-Signal 1 | Out-Null
  Drain-Signals
  $personalize.SetValue('SystemUsesLightTheme',1,[Microsoft.Win32.RegistryValueKind]::DWord)
  Wait-Signal 1 | Out-Null
  Assert-True ([LinkLineTaskbar]::IsLight()) 'The theme reader must observe the independently watched test key'
  Drain-Signals
  $watcher=[NativeVisibilityFixture]::FindWindow(('LinkLineTaskbarWatcher_'+$PID),$null)
  Assert-True ($watcher -ne [IntPtr]::Zero) 'A hidden top-level watcher must receive TaskbarCreated broadcasts'
  Assert-True (-not [NativeVisibilityFixture]::IsWindowVisible($watcher)) 'The event watcher must remain hidden'
  $created=[NativeVisibilityFixture]::RegisterWindowMessage('TaskbarCreated')
  [NativeVisibilityFixture]::SendMessage($watcher,$created,[IntPtr]::Zero,[IntPtr]::Zero) | Out-Null
  $signals=Wait-Signal 3
  Assert-True (($signals -band 3) -eq 3) 'TaskbarCreated must request both reinitialization and a layout update'
  Assert-True ([LinkLineTaskbar]::ReadSignal() -eq 0) 'Reading combined event flags must consume the queued signal'
  [LinkLineTaskbar]::Restore()
  Assert-True (-not [NativeVisibilityFixture]::IsWindow($watcher)) 'Stopping the host must destroy its watcher window'
  Drain-Signals
  [NativeVisibilityFixture]::Notify($tray,0x800B)
  $advanced.SetValue('TaskbarAl',0,[Microsoft.Win32.RegistryValueKind]::DWord)
  Assert-True (-not [LinkLineTaskbar]::Wait(200)) 'Stopped watchers must not wake the native loop'
  Assert-True ([LinkLineTaskbar]::ReadSignal() -eq 0) 'Stopped watchers must not retain callbacks or registry notifications'
  @{trayEvent=$true;taskbarEvent=$true;registryEvent=$true;recreateEvent=$true;stopped=$true} | ConvertTo-Json -Compress
} finally {
  [LinkLineTaskbar]::Restore()
  [NativeVisibilityFixture]::Dispose()
  $advanced.Dispose(); $personalize.Dispose(); $registry.Dispose()
  [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree('${registryRoot}',$false)
}
`)
  assert.deepEqual(result, [{ trayEvent: true, taskbarEvent: true, registryEvent: true, recreateEvent: true, stopped: true }])
})

test('native restore releases taskbar layout and popup styles before waiting for a blocked watcher', { skip: process.platform !== 'win32', timeout: 65000 }, () => {
  const result = runFixture(String.raw`
try {
  $child=[NativeVisibilityFixture]::Window('${prefix}Child',[IntPtr]::Zero,0,0,600,64)
  [NativeVisibilityFixture]::Decorate($child)
  $style=[NativeVisibilityFixture]::GetWindowLong($child,-16)
  $extended=[NativeVisibilityFixture]::GetWindowLong($child,-20)
  $bar=[NativeVisibilityFixture]::Window('${prefix}Shell_TrayWnd',[IntPtr]::Zero,0,0,1920,64)
  $rebar=[NativeVisibilityFixture]::Window('${prefix}ReBarWindow32',$bar,0,0,1800,64)
  $list=[NativeVisibilityFixture]::Window('${prefix}MSTaskSwWClass',$rebar,80,0,1720,64)
  [LinkLineTaskbar]::Init($child.ToInt64())
  [LinkLineTaskbar]::Spaces(400) | Out-Null
  [LinkLineTaskbar]::StartWatchers()
  Wait-Signal 1 | Out-Null
  Drain-Signals
  $watcher=[NativeVisibilityFixture]::FindWindow(('LinkLineTaskbarWatcher_'+$PID),$null)
  [NativeVisibilityFixture]::HoldWatcher($watcher)
  [NativeVisibilityFixture]::BeginRestore([LinkLineTaskbar])
  $end=[DateTime]::UtcNow.AddMilliseconds(600)
  $restored=$false
  do {
    $rectangle=New-Object NativeVisibilityFixture+Rect
    [NativeVisibilityFixture]::GetWindowRect($list,[ref]$rectangle) | Out-Null
    $restored=([NativeVisibilityFixture]::PhysicalParent($child) -eq [IntPtr]::Zero) -and (($rectangle.R-$rectangle.L) -eq 1720) -and ([NativeVisibilityFixture]::GetWindowLong($child,-16) -eq $style) -and ([NativeVisibilityFixture]::GetWindowLong($child,-20) -eq $extended)
    if(-not $restored) { Start-Sleep -Milliseconds 10 }
  } while (-not $restored -and [DateTime]::UtcNow -lt $end)
  Assert-True $restored 'The task list, popup parent, and styles must restore before the blocked watcher shutdown joins finish'
  Assert-True ([NativeVisibilityFixture]::IsWindow($watcher)) 'The fixture must still be holding watcher teardown while restoration has completed'
  [NativeVisibilityFixture]::FinishRestore()
  Assert-True (-not [NativeVisibilityFixture]::IsWindow($watcher)) 'Releasing the callback must let the watcher dispose cleanly'
  @{restoredBeforeJoin=$true;watcherReleased=$true} | ConvertTo-Json -Compress
} finally {
  [NativeVisibilityFixture]::ReleaseWatcher()
  [LinkLineTaskbar]::Restore()
  [NativeVisibilityFixture]::Dispose()
}
`)
  assert.deepEqual(result, [{ restoredBeforeJoin: true, watcherReleased: true }])
})

test('native integrity checks report a dead watcher while the hosted popup still exists', { skip: process.platform !== 'win32', timeout: 65000 }, () => {
  const result = runFixture(String.raw`
try {
  $child=[NativeVisibilityFixture]::Window('${prefix}Child',[IntPtr]::Zero,0,0,600,64)
  $bar=[NativeVisibilityFixture]::Window('${prefix}Shell_TrayWnd',[IntPtr]::Zero,0,0,1920,64)
  $rebar=[NativeVisibilityFixture]::Window('${prefix}ReBarWindow32',$bar,0,0,1800,64)
  $list=[NativeVisibilityFixture]::Window('${prefix}MSTaskSwWClass',$rebar,80,0,1720,64)
  [LinkLineTaskbar]::Init($child.ToInt64())
  [LinkLineTaskbar]::Spaces(400) | Out-Null
  [LinkLineTaskbar]::StartWatchers()
  Wait-Signal 1 | Out-Null
  $watcher=[NativeVisibilityFixture]::FindWindow(('LinkLineTaskbarWatcher_'+$PID),$null)
  [NativeVisibilityFixture]::QuitWatcher($watcher)
  Assert-True ([NativeVisibilityFixture]::IsWindow($child) -and ([NativeVisibilityFixture]::PhysicalParent($child) -eq $bar)) 'The fixture must reproduce watcher loss while the hosted HWND remains valid'
  $reported=$false
  try { [LinkLineTaskbar]::HostChanged() | Out-Null } catch { $reported=$_.Exception.Message.Contains('TASKBAR_WATCHER_UNRESPONSIVE') }
  Assert-True $reported 'A dead watcher must request host recovery instead of silently losing future taskbar changes'
  [LinkLineTaskbar]::Restore()
  Assert-True ([NativeVisibilityFixture]::PhysicalParent($child) -eq [IntPtr]::Zero) 'A failed watcher must still allow native parent restoration'
  @{deadWatcherReported=$true;popupRestored=$true} | ConvertTo-Json -Compress
} finally { [LinkLineTaskbar]::Restore(); [NativeVisibilityFixture]::Dispose() }
`)
  assert.deepEqual(result, [{ deadWatcherReported: true, popupRestored: true }])
})
