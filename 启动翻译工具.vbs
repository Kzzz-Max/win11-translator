' 静默启动「Win11 翻译」（不弹控制台窗口）
' 双击本文件即可；也可以把它放到 启动项/开始菜单 里。

Option Explicit

Dim shell, fso, root, exe, cmd
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
exe = root & "\release\Win11Translator\Win11Translator.exe"

If fso.FileExists(exe) Then
  shell.CurrentDirectory = root & "\release\Win11Translator"
  cmd = """" & exe & """"
Else
  exe = root & "\node_modules\electron\dist\electron.exe"
  If Not fso.FileExists(exe) Then
    MsgBox "找不到程序文件，请先执行 npm install 和 node build.mjs。", 48, "Win11 翻译"
    WScript.Quit 1
  End If
  shell.CurrentDirectory = root
  cmd = """" & exe & """ """ & root & """"
End If

' 第二个参数 0 = 隐藏窗口；Electron 是 GUI 程序，本身没有控制台，这里只是保险
shell.Run cmd, 0, False
