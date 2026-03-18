# aislop scan demo
# Run: vhs assets/scan.tape

Output assets/scan.gif

Set Shell "zsh"
Set Theme "Catppuccin Mocha"
Set FontFamily "Menlo"
Set FontSize 18
Set Width 1200
Set Height 600
Set Padding 30
Set LineHeight 1.4
Set LetterSpacing 0.5
Set TypingSpeed 40ms

Type "node dist/cli.js scan ../daily"
Sleep 500ms
Enter
Sleep 10s

Sleep 3s
