# Card Buy List

Tracks TCGplayer prices for your Pokémon and One Piece want lists and ranks every card by how good a time it is to buy. New lows get flagged at the top when you open it. Use the switch at the top to flip between Pokémon and One Piece.

## One-time setup for One Piece prices (about 10 minutes)

The One Piece price source only allows servers to download its data, not web pages. So a small job on GitHub downloads the prices once a day and saves them into your site. Pokémon works without any of this.

### 1. Put the files on GitHub
1. Make a free account at github.com.
2. Click **+** (top right) > **New repository**. Name it something like `card-buy-list`. Private is fine. Click **Create repository**.
3. On the new repo page, click **uploading an existing file**. Open the `cardwatch` folder on your computer, select everything inside it, and drag it onto the page. Click **Commit changes**.

### 2. Add the daily job
Your computer may hide the `.github` folder, so add this one file by hand:
1. In your repo, click **Add file** > **Create new file**.
2. For the name, type exactly: `.github/workflows/onepiece-prices.yml`
3. Open `github-workflow.yml` from the folder, copy everything in it, and paste it into the big box. Click **Commit changes**.

### 3. Run it once
1. Click the **Actions** tab. If GitHub asks, click the button to enable workflows.
2. Click **Update One Piece prices** on the left, then **Run workflow**.
3. Wait 2 or 3 minutes until it shows a green check. A file called `data/onepiece.json` now appears in your repo. After this it runs by itself every evening.

If it fails with a "permission denied" message: go to **Settings** > **Actions** > **General**, set **Workflow permissions** to **Read and write**, save, and run it again.

### 4. Connect your Netlify site to GitHub
1. In Netlify, open your site (classy-axolotl-3d9e5e), go to **Project configuration** (or **Site configuration**) > **Build & deploy**, and choose **Link repository** (or **Link to Git**).
2. Pick GitHub, sign in, and choose your `card-buy-list` repo.
3. Leave the build command empty and set the publish directory to `.` if asked. The included `netlify.toml` already sets this.

Your site keeps the same link. From now on, every daily price update publishes automatically, and any time you change a file on GitHub the site updates too. You don't need to drag folders onto Netlify anymore.

## Changing the One Piece characters
Edit `data/onepiece-config.json` in your GitHub repo (click the file, then the pencil icon). Each character has a `label` and the name text to look for. The next daily run picks it up.

## Install it on your phone
- **iPhone:** open your link in Safari, tap Share, then **Add to Home Screen**.
- **Android:** open your link in Chrome, tap the menu, then **Install app**.

## Using it
- **Pokémon:** the first load matches all 264 cards from your binder and takes a minute. Prices refresh when you open it (at most every 6 hours). **Needs a fix** shows cards the app couldn't match; tap **Fix match** to pick the right one. Tap a card's **Near mint / Played OK** tag to switch how it's priced. **Add card** searches every Pokémon card.
- **One Piece:** shows Leaders, Secret Rares, SP, Treasure Rares and Parallel / Alternate Art / Manga printings for your characters. Filter by character with the dropdown. **Remove** hides a card.
- **Currency:** switch between CAD and USD next to the search bar.
- Your Pokémon list, hidden One Piece cards and settings are saved in the browser on each device. They don't sync between your phone and computer.
