; Удаление Тендерного помощника: спрашиваем, удалить ли модели (до 7,5 ГБ), настройки и профиль компании.
; Отчёты в «Документы\Тендерный помощник» не трогаем.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION "Удалить скачанные модели, настройки и профиль компании?$\r$\n$\r$\nОтчёты в папке «Документы\Тендерный помощник» останутся." /SD IDNO IDNO skipModels
      RMDir /r "$LOCALAPPDATA\TenderPomoshnik"
      ReadEnvStr $0 "ProgramData"
      RMDir /r "$0\TenderPomoshnik"
    skipModels:
  ${endIf}
!macroend
