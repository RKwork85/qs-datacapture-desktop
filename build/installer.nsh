; 安装向导：用户告知页 + 必须勾选同意才能继续
; electron-builder 会在「选择安装目录」之后插入该页

!include "nsDialogs.nsh"
!include "LogicLib.nsh"

Var qsAgreeDialog
Var qsAgreeCheck

!macro customPageAfterChangeDir
  Page custom qsAgreePageShow qsAgreePageLeave
!macroend

Function qsAgreePageShow
  nsDialogs::Create 1018
  Pop $qsAgreeDialog
  ${If} $qsAgreeDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 12u "用户告知"
  Pop $0

  ; 用 Label 显示多行（${NSD_CreateText} 是单行控件，会吞掉换行）
  ${NSD_CreateLabel} 0 18u 100% 105u \
    "欢迎你使用轻采QS,$\r$\n\
该软件无广告，免登录，不收费，$\r$\n\
请勿二次盗卖，商用需另行授权，$\r$\n\
请分享给更多的勤劳的自媒体人，谢谢！$\r$\n\
b站up主：muzi_hhh，$\r$\n\
主页链接：https://space.bilibili.com/3494350415727030?spm_id_from=333.1007.0.0"
  Pop $0

  ${NSD_CreateCheckbox} 0 128u 100% 12u "我已阅读并同意上述说明"
  Pop $qsAgreeCheck
  ${NSD_SetState} $qsAgreeCheck ${BST_UNCHECKED}

  nsDialogs::Show
FunctionEnd

Function qsAgreePageLeave
  ${NSD_GetState} $qsAgreeCheck $0
  ${If} $0 != ${BST_CHECKED}
    MessageBox MB_ICONEXCLAMATION|MB_OK "请先勾选「我已阅读并同意上述说明」后再继续安装。"
    Abort
  ${EndIf}
FunctionEnd

; 安装文件拷贝完成后，用默认浏览器打开 B 站主页
!macro customInstall
  ExecShell "open" "https://space.bilibili.com/3494350415727030?spm_id_from=333.1007.0.0"
!macroend
