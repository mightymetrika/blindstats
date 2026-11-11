# blindstats researcher preview — testing kit (draft v0.1)

Use **synthetic data only**. This is a usability/feasibility evaluation of an early research-preview application, not approval for uploading confidential or regulated research data.

Start with [TESTING_PROTOCOL.md](TESTING_PROTOCOL.md). No real research dataset is required. The kit includes:

| Operating system | Local, offline helper | How to run |
| --- | --- | --- |
| Windows | [`scripts/researcher-preview/researcher-preview-windows.ps1`](../../scripts/researcher-preview/researcher-preview-windows.ps1) | Windows PowerShell 5.1+ (instructions below) |
| macOS | [`scripts/researcher-preview/researcher-preview-macos.command`](../../scripts/researcher-preview/researcher-preview-macos.command) | Terminal: `sh` (instructions below) |
| Linux | [`scripts/researcher-preview/researcher-preview-linux.sh`](../../scripts/researcher-preview/researcher-preview-linux.sh) | Terminal: `sh` (instructions below) |

Scripts do not access the network, install packages, collect credentials, or contact blindstats. They create a synthetic source CSV and, after you download the blinded CSV from blindstats, a descriptive **analysis artifact** for Analysis Lock. They use the same simple 48-row fixture on all three systems.

**No script required?** Download [synthetic_study.csv](synthetic_study.csv) and supply any harmless local text file as the analysis artifact. The scripted route provides consistent summaries for comparison.

## Command examples

Download the single helper for your OS and open your shell in its download folder. Change the download path if your browser uses another folder.

**Windows PowerShell:**

```powershell
cd "$HOME\Downloads"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\researcher-preview-windows.ps1 -Action Generate
# After using blindstats and downloading synthetic_study_blinded.csv:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\researcher-preview-windows.ps1 -Action Analyze -InputCsv "$HOME\Downloads\synthetic_study_blinded.csv"
```

**macOS Terminal:**

```sh
cd ~/Downloads
sh ./researcher-preview-macos.command generate
# After blinding and downloading synthetic_study_blinded.csv:
sh ./researcher-preview-macos.command analyze "$HOME/Downloads/synthetic_study_blinded.csv"
```

**Linux terminal:**

```sh
cd ~/Downloads
sh ./researcher-preview-linux.sh generate
# After blinding and downloading synthetic_study_blinded.csv:
sh ./researcher-preview-linux.sh analyze "$HOME/Downloads/synthetic_study_blinded.csv"
```

The output folder is `~/blindstats-preview-files` (Windows: under your user home). You can override it: Windows `-OutputDir <folder>`; macOS/Linux `BLINDSTATS_PREVIEW_DIR=/some/folder sh ...`.

Scripts are source-readable; inspect any downloaded script before executing it. macOS users should run the `.command` script through Terminal with `sh` rather than double-clicking it. On macOS/Linux, no `sudo`, `chmod`, or new package installation is needed.

## Distribution

For participants, link **the appropriate OS-specific script and the protocol directly in the invitation email**. A repository homepage is not required as an intermediate step. When the kit is committed on `main`, use the permanent GitHub `main` links or release assets in the invitation; if using `/blob/` links, have researchers click **Download raw file** before running the scripts. Consider pinning a release tag/commit for reproducible tests rather than linking mutable `main` indefinitely.

`FEEDBACK_QUESTIONS.md` is a planning instrument, not an active submission endpoint. Arrange a private feedback form or approved collection channel before invitations. Never ask participants to post responses containing personal information or research files in public GitHub issues.
