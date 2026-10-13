' Roda proxy-loop.cmd sem abrir janela.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """" & dir & "\proxy-loop.cmd""", 0, False
