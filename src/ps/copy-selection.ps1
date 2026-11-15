param(
  [int]$DelayMs = 60,
  [int]$WaitMs = 700,
  [int]$Attempts = 2
)

# 把当前前台窗口里选中的内容复制到系统剪贴板。
#
# 关键点（踩过的坑）：
# 1) 注入前先松开 Ctrl/Alt/Shift/Win —— 用户按着 Alt+Shift 触发快捷键时，
#    残留的修饰键会把 Ctrl+C 叠成 Ctrl+Alt+Shift+C（Edge 里那是"检查元素"），
#    结果就是"文字明明选中了，剪贴板却没变"。
# 2) keybd_event 要带真实扫描码（MapVirtualKey），并在按键之间留间隔，
#    背靠背发送时 Chromium 一类应用会漏键。
# 3) 用 GetClipboardSequenceNumber 判断剪贴板是否真的被写入，不预先清空用户的剪贴板。
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type @"
using System;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
public class KeySim {
  [DllImport("user32.dll")] static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint uCode, uint uMapType);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();

  static void Down(byte vk) { keybd_event(vk, (byte)MapVirtualKey(vk, 0), 0, UIntPtr.Zero); }
  static void Up(byte vk) { keybd_event(vk, (byte)MapVirtualKey(vk, 0), 2, UIntPtr.Zero); }

  // 兜底松开可能被按住的修饰键（Win 只发 up，避免弹出开始菜单）
  public static void ReleaseModifiers() {
    Up(0x11); Up(0x10); Up(0x12); Up(0x5B); Up(0x5C);
  }

  public static void CtrlC() {
    Down(0x11); Thread.Sleep(18);
    Down(0x43); Thread.Sleep(18);
    Up(0x43);   Thread.Sleep(18);
    Up(0x11);
  }

  public static string ForegroundTitle() {
    StringBuilder sb = new StringBuilder(300);
    GetWindowText(GetForegroundWindow(), sb, 300);
    return sb.ToString();
  }
}
"@

Start-Sleep -Milliseconds $DelayMs
[KeySim]::ReleaseModifiers()
Start-Sleep -Milliseconds 40

$title = [KeySim]::ForegroundTitle()
$before = [KeySim]::GetClipboardSequenceNumber()
$changed = $false

for ($i = 0; $i -lt $Attempts; $i++) {
  [KeySim]::CtrlC()
  $deadline = [DateTime]::Now.AddMilliseconds($WaitMs)
  while ([DateTime]::Now -lt $deadline) {
    Start-Sleep -Milliseconds 35
    if ([KeySim]::GetClipboardSequenceNumber() -ne $before) { $changed = $true; break }
  }
  if ($changed) { break }
  Start-Sleep -Milliseconds 120
}

[Console]::Out.WriteLine("FG:" + $title)
[Console]::Out.WriteLine("CHANGED:" + [int]$changed)
[Console]::Out.WriteLine("SEQ:" + $before + "->" + [KeySim]::GetClipboardSequenceNumber())
[Console]::Out.WriteLine('OK')
