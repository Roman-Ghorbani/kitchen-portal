# Kitchen Manager Handbook

How to run the kitchen with Kitchen Portal. It is written for a new kitchen manager who has never used the app, and it assumes nobody is around to ask. The same text is in the app under **Handbook**.

## The short version {#short}

- **Sunday, at chapter:** draw the week that starts eight days later. The house can see it on the Board as soon as it is drawn.
- **During the week:** if somebody does not show up, mark him on the **Weeks** page. Everything else runs itself: brothers put shifts up for grabs and take them, and a Slack reminder goes out the evening before each shift.
- **Start of semester:** follow the checklist below, top to bottom.

Everything you do is written to the **Audit log**, with your name on it. That log settles "I never knew I was on" and "I did show up".

## How the draw works {#rules}

- Every brother on duty is on one **crew**, either lunch or dinner. His crew decides which meal he cleans. His class year does not, so you can put a junior on dinner or a live-in senior on lunch.
- **Exempt** brothers are never drawn. Seniors are usually exempt, and so are some officers. An exempt brother keeps his crew and his points, so lifting the exemption puts him straight back where he was.
- For each open seat the draw takes, in order: anyone who owes a **make-up** shift, then whoever has the **fewest points**, then whoever has gone longest without serving. Remaining ties are broken by a random draw that is fixed for that week.
- Nobody is drawn twice in one Monday–Sunday week, except for a make-up shift.
- **Standing conflicts** are respected. These are the days each brother says he can never do, entered from his Home page.
- Being on the schedule earns the points straight away. If he does not show up, marking a **no-show** takes the points back and adds a make-up shift.

## Points {#points}

- A normal shift is worth 1 point. You can make a shift worth more (1.5×, 2× or 3×) on the Weeks page, for example the night after a party.
- **Points carry over between semesters and are never reset.** Over a brother's whole time in the house, points are what keep the load fair. Zeroing everyone would reward the people who skipped out last term.
- To change points by hand, open the brother's page from the Roster. Add or subtract whole or half points, and give a reason; the reason goes on his record.
- To change many people at once, go to **Roster → Adjust points**. You can add, subtract, set to a value, or **rebase**. Pick who it applies to (the people you selected, a crew, or everyone), press **Preview**, check the list, then **Apply**.
- **Rebase** subtracts the lowest score from everybody in the group. The numbers get smaller, but the order and the gaps between people stay exactly the same. Use it if the numbers get large, and never simply zero everyone.
- New brothers start level with the lowest score on their crew, not at zero. Starting at zero would make them first in line for every shift for weeks.

## Start of semester {#semester}

Do these in order. The whole list takes about an hour.

1. **Settings → Semester → Start the next semester.** Check the name and dates. The roster, everyone's points, meal days, crew sizes and late-plate settings carry over. Standing conflicts start fresh, because class schedules change. Last semester's weeks stay in the record.
2. **Settings → Roster defaults.** Check which crew each class year joins by default. The usual setup is juniors on lunch, freshmen and sophomores on dinner, and seniors exempt. These defaults only apply to people you add or import from now on; they never move anyone already on the roster.
3. **Roster → Import.** Paste or upload the house roster. The chapter's export works, and so does a spreadsheet saved as CSV, cells copied straight from Google Sheets, or a typed list with headings like *Juniors*. If the file only has pledge classes, you will be asked what year each pledge class is in now; the app remembers your answers for next time. With a room column, tick **only people who live in the house**. To clear out last year's people, tick **take anyone not in this roster off**. Press **Preview changes**, untick anything that looks wrong, then import.
4. **Roster → Everyone.** Fix anyone the defaults got wrong. Tick the boxes next to their names, then use **→ Lunch crew**, **→ Dinner crew** or **Exempt…** in the bar at the bottom. Typical fixes are a junior who pledged late, a live-in senior who is not exempt, and an officer who is exempt.
5. **Roster → Not ready → Issue setup codes.** Every new brother needs a one-time code to claim his account and choose a PIN. Codes are shown once, so copy each one into a Slack DM, or print the sheet and hand it out at chapter. Codes expire after 7 days; issuing a new code cancels the old one.
6. **Ask everyone to enter their standing conflicts** (Home → Standing availability) before the first draw. Then check **Roster → Day by day**. A thin bar means a day that will be hard to fill.
7. **Draw the first week** from the Dashboard.
8. **Make sure the kitchen tablet is still paired** (Late plates → Kitchen tablet). Remind the chefs that they enter menus on the tablet.

## Every week {#weekly}

1. **At Sunday chapter, draw next week.** It is the week that starts eight days later, which gives everybody a full week's notice. On the Dashboard, pick the week and press **Draw it and post it**. To announce it at chapter, use the Dashboard's **Copy Chapter Announcement** button.
2. **Check "Up for grabs" on the Dashboard.** These are shifts someone offered that nobody has taken. It is his shift until somebody takes it, so a shift nobody takes is still his.
3. **Mark absences** on the Weeks page. Choose **No-show** if he did not come: he loses the points and owes a make-up. Choose **Excuse** if he had a good reason: he earns no points for it, but owes nothing either. If you change your mind, just set the right answer; the points are recalculated, so a correction is always safe.
4. If you are short-handed on a given day, use **+ Add someone** on that shift in the Weeks page to put somebody on it directly.

## People changes during the semester {#people}

| Situation | What to do |
|---|---|
| Someone moves in | Roster → **+ Add a brother**, and tick *give me his setup code now* |
| Someone moves out, graduates or depledges | Select him → **Take off roster**. His history and points are kept, and he can be put back from *Off roster*. |
| Someone becomes an officer, or is injured | Select him → **Exempt…** and choose the reason |
| He is on the wrong crew | Select him → **→ Lunch crew** or **→ Dinner crew**. Weeks already posted are not changed; fix those on the Weeks page. |
| He forgot his PIN, or thinks someone else knows it | His page → Account → **Reset forgotten PIN**. This signs him out everywhere and gives you a new setup code for him. |
| You added someone by mistake | His page → Account → **Delete**. This is only possible if he has never been scheduled. |
| He wants to change his room or Slack ID | He can do it himself: tap his name at the top of any page to open **Profile**. |
| A points dispute | Open his page. **Every shift** and **Everything on record** show exactly what happened and when, including every correction and who made it. |

Each brother's page also has **manager notes**. Only you can see them, and they are handed down with the app. It is a good place for things like "exempt Spring only, chapter approved".

## The chefs and late plates {#kitchen}

- **Late plates → Kitchen tablet.** Pair the chefs' tablet here. Start a pairing, then on the tablet open `/kitchen/pair` and type the code; the code works for 15 minutes. If a tablet is lost, revoke it here.
- The chefs run the late-plate queue and set the cutoffs on the tablet. Every plate shows the brother's allergies, and a chef has to acknowledge them.
- On the same page you can pause late plates, choose which meals take them, or put a banner on the brothers' page (for example "No late plates Friday, formal").
- If a chef complains that a plate was not requested, or was requested too late, check the **Audit log**. Filter by *Late plates* and by the brother's name to see exactly when it was requested.
- Brothers keep their allergies on their **Profile**, and they are attached to every plate automatically.

## The house display (TV) {#tv}

The dining room TV is a separate app, **House Display**, running on the same Raspberry Pi. It shows the crews, menus and late plates from this portal, plus weather, the bus and announcements. Its consoles (`/admin` for you, `/post` for the communications director) only open from devices on the house's **Tailscale** network. There is deliberately no link to them from this public site. To get access, ask whoever runs the Pi to share the Pi with your Tailscale account.

## Your first day as manager {#handoff}

The outgoing manager, or whoever has access to the Pi, should do these with you:

1. **Your login.** On the Pi, run `cd ~/kitchen-portal && npm run admin:credentials`. Choose a password and scan the QR code into your authenticator app. The two lines it prints go into `.env.production`, replacing the old ones. Then run `sudo systemctl restart kitchen-portal`. The old manager's login stops working at that moment.
2. **Tailscale.** Get the Pi shared with your Tailscale account. That gives you the TV consoles and SSH to the Pi.
3. **The backup passphrase.** Put `BACKUP_PASSPHRASE` from `.env.production` into your own password manager. Without it, a backup cannot be restored.
4. **Read this handbook** and `docs/OPERATIONS.md` in the repository. The latter covers deploying, backups and restoring.

When you hand over at the end of your term, do the same for your successor, and remove yourself from the Pi's Tailscale sharing.

## When something breaks {#trouble}

- **The site is down.** SSH to the Pi over Tailscale and run `systemctl status kitchen-portal cloudflared`. `sudo systemctl restart kitchen-portal` fixes most things. If the Pi is off, turning it back on starts everything automatically.
- **The TV is blank or frozen.** Unplug and replug the Pi, or run `sudo systemctl restart house-display`. If the portal is down, the TV keeps showing the last good data.
- **Something was changed that should not have been.** The Audit log shows who did what and when. Most mistakes can be undone from the Roster or the Weeks page.
- **The database is damaged or the Pi died.** A backup is taken to the USB drive every night. To restore it, follow *Restoring after a failure* in `docs/OPERATIONS.md`. You will need the backup passphrase.
