# Invoice Vault — Google setup guide

One-time setup, about 10 minutes, on a computer (not phone).

> **Which Google account?** The photos will live in the Drive of whichever account
> you use below. Use the account that should *own* the business files
> (the business / your father's Google account is best). Either of you can still
> use the website — the website login is separate from Google.

---

## 1. Create the script

1. Sign in to that Google account and open **https://script.google.com**.
2. Click **New project**.
3. Click "Untitled project" at the top and rename it to **Invoice Vault**.
4. Delete everything in the `Code.gs` editor, then paste the entire contents of
   `apps-script.gs` (this folder). Press **Ctrl+S** / **Cmd+S** to save.
5. Click the ⚙️ **Project Settings** (left sidebar) → set **Time zone** to
   `(GMT+05:30) India Standard Time`.

## 2. Create the private Drive folder

1. Back in the editor (`< >` icon), pick **`SETUP_1_createVault`** in the function
   dropdown at the top, then click **Run**.
2. Google asks for permission:
   - **Review permissions** → choose your account.
   - You'll see *"Google hasn't verified this app"*. That's expected — it's your own
     script. Click **Advanced** → **Go to Invoice Vault (unsafe)** → **Allow**.
3. The log at the bottom shows `Vault ready: https://drive.google.com/...`.
   A folder named **Invoice Vault** now exists in your Drive with sub-folders
   Sales, Purchase, Delivery Note, URD Bill, Expense, Other.

## 3. Set the two logins

1. Scroll to the `SETUP_2_setUsers` function. Replace the placeholders:

   ```js
   const users = [
     ['first-username',  'a-strong-password-1'],
     ['second-username', 'a-strong-password-2'],
   ];
   ```

   Passwords must be at least 10 characters. A short sentence works well
   (e.g. `mango-tractor-river-42`).
2. Select **`SETUP_2_setUsers`** in the dropdown → **Run**. The log says
   `Saved users: ...`.
3. **Important:** put the placeholders back
   (`'USERNAME_1', 'PASSWORD_1'` and `'USERNAME_2', 'PASSWORD_2'`) and save.
   Only a scrambled hash is kept (in Project Settings → Script Properties);
   the real password is not stored anywhere.

## 4. Publish it as a web app

1. Top right: **Deploy → New deployment**.
2. Click the ⚙️ next to "Select type" → **Web app**.
3. Fill in:
   - Description: `v1`
   - **Execute as:** `Me`
   - **Who has access:** `Anyone`
     *(This only means the website can reach the script. Every request still needs a
     valid username + password; without one, nothing is returned.)*
4. **Deploy** → copy the **Web app URL** (ends in `/exec`).
5. Send that URL to Claude (it is not a secret) — it gets pasted into the website.

Quick check: opening the URL in a browser should show
`Invoice Vault API is running.`

---

## Later: common tasks

| Task | How |
|---|---|
| **Change a password** | Edit `SETUP_2_setUsers` with the new password(s), Run, put placeholders back. That person is signed out on all devices. |
| **Lost a phone / sign everyone out** | Run `RESET_signOutEveryone`. |
| **Update the script code** | Paste new code → **Deploy → Manage deployments** → ✏️ edit → Version: **New version** → Deploy. The URL stays the same. |
| **Recover a deleted bill** | Deleted files go to Google Drive's **Bin** for 30 days. Restore from there. |
| **Too many wrong passwords** | Login is blocked for 15 minutes, then works again. |

## Where files go

```
Invoice Vault/
├── Sales/2026-11/SALES_2026-11-20_001.jpg
│                 SALES_2026-11-20_002.jpg
├── Purchase/2026-11/PURCHASE_2026-11-20_001.jpg
├── Delivery Note/...
├── URD Bill/...
├── Expense/...
├── Other/...
└── _thumbnails/        (small previews for the website — don't edit)
```

Numbers restart at 001 each day, per bill type, and are never reused.
Don't rename files by hand in Drive: the website uses the name to keep the order.
