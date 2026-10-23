# Real-device test (about 10 minutes)

Run this on the real phone and the real classroom screen. Automated tests cover the logic;
only this tells us whether it works in your room.

**You need:** your iPhone, the classroom screen (now: the Mac on the projector), Wi-Fi.
**Addresses during testing:** `https://<tunnel>/show/` (screen) and `https://<tunnel>/speak/` (phone).
The current tunnel address is in the chat.

Write down anything odd as you go: what you said, what appeared, how long it took.

---

## 1. Install on the home screen (Phase 3)
1. In Safari, open the `/speak/` address.
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. Open **Captions** from the home screen. Allow the microphone when asked.

## 2. Pair and start (Phase 2)
1. On the screen, open the `/show/` address and make it full screen. A 4-character code and a QR code appear.
2. On the phone, scan the QR code, or type the code.
3. Check that the three chips at the top read **Mic: off · Screen XXXX: connected · Engine: online**.
4. Tap **Start captions**. Allow the microphone if asked.
   - The screen switches to the black caption view within about 2 seconds.
   - The Mic chip turns green and says **listening**.

## 3. Read the script (Phase 2)
Read at your normal teaching pace, without slowing down for the machine.

**English**
> Good morning everyone. Today we are going to learn how to search inside files.
> The command is grep. To find the word error in a log file, type grep error log dot txt.
> If you get permission denied, use sudo, or change the permissions with chmod.
> You can send the output of one command into another with a pipe. For example, ls pipe grep txt.
> Then sort the results with sort. Finally, make a new folder with mkdir and move into it with cd.

Then open **Settings**, switch the language to **Français**, and read:

**Français**
> Bonjour à tous. Aujourd'hui, nous allons apprendre à chercher dans les fichiers.
> La commande s'appelle grep. Pour trouver le mot erreur, tapez grep erreur journal point txt.
> Si vous avez une erreur de permission, utilisez sudo, ou changez les droits avec chmod.
> On peut envoyer la sortie d'une commande vers une autre avec un pipe, par exemple ls pipe grep txt.
> Enfin, créez un dossier avec mkdir et entrez dedans avec cd.

**Note for each language:**
- How long between saying a word and seeing it on the screen? Fine, or noticeably slow?
- Grey words while you speak, turning white: does the text jump around?
- Which bash words came out **wrong**? Write down what appeared instead. That goes straight into the word list.
- Can you read it from the back of the room?

## 4. Stay silent for 30 seconds (Phase 2)
1. Stop talking for 30 seconds. Don't touch the phone.
2. Start talking again.
   - The captions must come back on their own. The Mic chip may say "restarting" briefly, then "listening".
   - If a yellow box says "Tap here to carry on", note it. That means iOS needed a tap.

## 5. Wi-Fi off for 10 seconds (Phase 3)
1. While live, swipe down and turn **Wi-Fi off** on the phone, count to 10, then turn it back on.
2. Keep talking. Note how long until captions reappear on the screen.

## 6. Lock, unlock and switch apps (Phase 3)
1. Lock the phone for 5 seconds, then unlock it. Does listening carry on, or does it ask for a tap?
2. Switch to another app for 5 seconds, then come back. Same question.
3. Does the phone screen stay awake on its own while captions are live?

## 7. A second phone as the student (Phase 3)
1. On another phone, open `/view/` and enter the same code.
2. Talk. Captions appear there too, and you can scroll back through the whole session.

## Desktop app v2: computer microphone (about 15 minutes)
**Get it:** https://github.com/gastonche/live-classroom-captions/actions → latest "Desktop app" run → Artifacts.
- **Windows:** unzip and run the setup `.exe`. If SmartScreen appears: **More info → Run anyway**.
- **Mac:** unzip, move **Captions** to Applications, open it. If macOS blocks it: **System Settings → Privacy & Security → Open Anyway**.

1. **First run:** a panel says speech models are needed. Choose **CC menu** (Mac menu bar, or the Windows tray near the clock) → **Download speech models**. Watch the progress. Optionally turn Wi-Fi off for 20 s mid-download: it should resume.
2. **Microphone:** CC menu → **Microphone** → pick the mic you'll teach with. Choose **Start captions** and allow microphone access when asked.
3. **Speak** the English and French scripts (step 3 above) at normal pace, from where you usually stand. Note wrong or missing words, and how long until words appear.
4. **Silence:** stay quiet for 60 s. Nothing should appear. Then talk again: captions continue.
5. **Over other apps:** full-screen terminal, VS Code, browser, PowerPoint or Keynote slide show. Captions stay on top, and clicks go through them.
6. **Students:** put a phone on the **same Wi-Fi**. CC menu → **Show student QR code**, scan it (the card shows an address like `192.168.1.20:47213`). Captions follow on the phone. Allow the network prompt if Windows or Linux asks. Then turn the phone's Wi-Fi off for 10 s and back on: it reconnects and catches up.
7. **Mic problems:** unplug the USB mic for 10 s while live. The screen should say "Captions interrupted: microphone problem", then recover by itself when you plug it back.
8. **End:** CC menu → **End and save transcript**. Check Documents/Captions for the `.txt` file.

Send back: what worked, any wrong words, the computer's model, processor and RAM, and the mic used.

## Captions app (Mac overlay)
1. The room code and QR card show on the projector until your phone pairs.
2. Start captions: the box appears at the bottom. Click something **right under** the captions: the click reaches it.
3. Top/Bottom on the phone, **CC menu → Captions position**, and **Ctrl+Option+Cmd+↑ / ↓** all move it.
   **Ctrl+Option+Cmd+C** hides and shows it.
4. Full-screen Terminal, VS Code and browser: captions stay on top. Swipe between desktops: captions follow.
5. Keynote: Play a slideshow on the projector. Captions stay visible?
6. Mirror the displays (System Settings → Displays). Captions still visible?

---

**Report back:** for each step, "OK" or what went wrong. A photo of the screen helps if something looks off.

## Results log
| Date | Phone / iOS | Screen | Steps passed | Notes |
|---|---|---|---|---|
| 2026-10-21 | iPhone, iOS 18.7 | Mac + CASIO projector | 2, 3, 4 (real class) | Worked really well; mic got stuck once (listening, no words). Watchdog added; watching for repeats. |
| 2026-10-21 | iPhone, iOS 18.7 | Mac + LG TV (AirPlay, extended), Captions app | Overlay 1, 3 (phone only), 4 | QR works, captions work. Phone Top/Bottom works. Follows across desktops (59 switches). Menu/shortcut, click-through, Keynote and mirroring not yet checked. |
| | | | | |
