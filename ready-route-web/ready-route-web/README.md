# Ready Route: AI disaster assistance navigator

A chat + map website that helps people find disaster help after a hurricane, wildfire,
flood, or other emergency. Built on Microsoft Foundry agents:

- **Assistance-agent**: answers questions using FEMA and National Weather Service data
- **Safety-EscalationAgent**: checks for scams, emergencies, and cases that need a person
- **WriteUp-agent**: writes a case summary for a human representative

The map shows nearby open shelters and FEMA recovery centers (FEMA) and hospitals,
fire/EMS, and police stations (USGS The National Map).

## What you need first

1. **Python 3.10 or newer**
2. **Azure CLI**: https://learn.microsoft.com/cli/azure/install-azure-cli
3. **Access to the ReliefRN Foundry project.** Ask the project owner to give your
   account the **Foundry User** role on ReliefRN (Azure Portal > ReliefRN > Access control (IAM)).

## Run it

```
python -m venv .venv
.venv\Scripts\activate          (Mac/Linux: source .venv/bin/activate)
pip install -r requirements.txt
az login --tenant 9e857255-df57-4c47-a0c0-0546460380cb
python server.py
```

Open **http://localhost:5000**.

## Files

| File | What it does |
|---|---|
| `server.py` | Backend. Signs in with your Azure account and talks to the three agents. |
| `static/index.html` | The website: chat, Call 911 button, Talk to a person, map. |
| `static/nearby-emergency-places.js` | Loads nearby shelters, recovery centers, hospitals, fire, and police onto the map. |
| `requirements.txt` | Python packages to install. |

## Troubleshooting

- **"Ready Route can't reach its assistant"**: check the terminal for the real error.
  Usually your sign-in expired; run the `az login` command again.
- **Permission or 403 error**: your account needs the Foundry User role on ReliefRN.
- **No shelters on the map**: normal when no disaster is active. Shelters and recovery
  centers only appear during active disasters.

## Privacy

No API keys or secrets are stored in this code. Sign-in uses each person's own Azure account.
Case reports are saved to a local `reports/` folder, which is excluded from Git.
