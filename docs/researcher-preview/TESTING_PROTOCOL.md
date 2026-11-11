# Try blindstats — researcher exercise

**Use only the supplied synthetic dataset.** Do not use real, identifiable, confidential, or client data. blindstats is an early research preview.

**Download from GitHub** (open the link and select **Download raw file**):

- [Synthetic CSV](https://github.com/mightymetrika/blindstats/blob/1c426cd/docs/researcher-preview/synthetic_study.csv) — `synthetic_study.csv`
- Analysis helper (choose your OS): [Windows](https://github.com/mightymetrika/blindstats/blob/1c426cd/scripts/researcher-preview/researcher-preview-windows.ps1) · [macOS](https://github.com/mightymetrika/blindstats/blob/1c426cd/scripts/researcher-preview/researcher-preview-macos.command) · [Linux](https://github.com/mightymetrika/blindstats/blob/1c426cd/scripts/researcher-preview/researcher-preview-linux.sh)

Save the CSV and helper in **Downloads**. Sign in at [blindstats.com](https://blindstats.com) with your invited account.

## Individual exercise

1. **Create a Study** named *Synthetic preview*. In **Blinding plan**, require an **Analysis Lock**, allow **self-authorization**, acknowledge the warning, and activate the plan.
2. **Blind the data.** Select `synthetic_study.csv`, blind the `group` column, generate and save the blinded CSV, public receipt, and unblinding secret; then register the package.
3. **Analyze the blinded CSV** using the command for your OS below. It creates `analysis_artifact.txt` locally.
4. **Lock the analysis.** Select `analysis_artifact.txt`, download the lock receipt, and register the Analysis Lock.
5. **Unblind.** Request and authorize unblinding against the lock, supply your saved local secret, complete unblinding, and review **Audit history**.
6. **Share your feedback:** **[Private feedback form — link to be added before invitations]**.

## Run the analysis helper

After blindstats downloads `synthetic_study_blinded.csv`, use the command for your computer. If your browser changed a filename or folder, adjust the command accordingly.

**Windows — PowerShell**
```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$HOME\Downloads\researcher-preview-windows.ps1" -Action Analyze -InputCsv "$HOME\Downloads\synthetic_study_blinded.csv"
```

**macOS — Terminal**
```sh
sh "$HOME/Downloads/researcher-preview-macos.command" analyze "$HOME/Downloads/synthetic_study_blinded.csv"
```

**Linux — Terminal**
```sh
sh "$HOME/Downloads/researcher-preview-linux.sh" analyze "$HOME/Downloads/synthetic_study_blinded.csv"
```

The helper writes `analysis_artifact.txt` to `blindstats-preview-files` in your home folder. It analyzes only the **blinded** CSV; no R or Python installation is needed.

## Optional paired exercise

With **two separate invited accounts**, the custodian chooses **Independent authorization** and assigns the other participant the **Blinded analyst** role. Transfer only the synthetic **blinded CSV** to the analyst. The analyst registers the lock and requests unblinding; the custodian authorizes, then transfers the unblinding secret. The analyst completes unblinding. Both submit feedback.

**Please do not send passwords, research files, or unblinding secrets to the feedback organizer.** The app does not yet transfer files between users; use an agreed external channel for this synthetic exercise.
