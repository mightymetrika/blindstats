# Single-person blindstats exercise (alternative)

Use this option if you are testing on your own, or after completing the [recommended paired exercise](https://github.com/mightymetrika/blindstats/blob/main/docs/researcher-preview/PAIRED_TESTING_PROTOCOL.md). Use **only synthetic data**—never real, confidential, client, or regulated data. blindstats is an early research preview.

**Files from GitHub:** [Synthetic CSV](https://github.com/mightymetrika/blindstats/blob/1c426cd/docs/researcher-preview/synthetic_study.csv) · Analysis helper: [Windows](https://github.com/mightymetrika/blindstats/blob/1c426cd/scripts/researcher-preview/researcher-preview-windows.ps1) / [macOS](https://github.com/mightymetrika/blindstats/blob/1c426cd/scripts/researcher-preview/researcher-preview-macos.command) / [Linux](https://github.com/mightymetrika/blindstats/blob/1c426cd/scripts/researcher-preview/researcher-preview-linux.sh). On each file page choose **Download raw file**. Save the CSV or helper you need in **Downloads**. Nothing is attached to the invitation email.

Sign in at [blindstats.com](https://blindstats.com) using your invited account.

## Exercise

1. **Set up:** Create a Study (*Synthetic preview*) and Blinding workflow. Under **Blinding plan**, require an **Analysis Lock**, select **Self-authorization permitted**, acknowledge the warning, **Save draft**, and activate the plan.
2. **Blind:** In **Blinded package**, select `synthetic_study.csv`, blind the `group` column, download the blinded CSV, public receipt, and unblinding secret, and register the package.
3. **Analyze the blinded CSV** using the **analysis helper** command for your OS below. Save the blinded CSV as `synthetic_study_blinded.csv` in **Downloads**. It creates `analysis_artifact.txt` locally.
4. **Lock and unblind:** Register an **Analysis Lock** using `analysis_artifact.txt` (save the lock receipt). Request and self-authorize unblinding against the lock, supply your locally saved unblinding secret, complete unblinding, and inspect **Audit history**.
5. **Share feedback:** [Private feedback form](https://blindstats.com/feedback).

## Analysis helper commands

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
The helper creates `analysis_artifact.txt` in your home folder under `blindstats-preview-files`. If your browser saved the blinded CSV elsewhere or renamed it, adjust its path in the command.

**Do not send passwords, research files, or unblinding secrets to the feedback organizer.**
