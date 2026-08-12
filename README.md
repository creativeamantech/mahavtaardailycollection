# Daily Collection Hub

Create a complete mobile-friendly web app named Mahavtaar Daily Collection. No login anywhere. Anyone with the link can use it. Fixed executives only: Aarti, Ankita, Bharti, Julee, Pooja, Sunanda, Vinita. No custom names. Page 1: Collection Entry. Fields: Executive Name dropdown, Loan ID/Loan Number, Amount, Date auto-today read-only, no past date, time auto read-only. Mandatory checkbox text: I confirm this is not ECS or Special payment, and this is the payment brought by the selected executive, and amount is correct. Without checking, do not allow submit or save. On Submit: Show confirmation popup with all details, Confirm or Cancel/Edit. On Confirm: Save entry, generate simple receipt (no receipt number), show name, loan ID, amount, date, time, status confirmed. Add buttons for print and download PDF. Save confirmed entry to Google Sheet with columns: Executive Name, Loan ID, Amount, Date, Time, Created At, Status. Page 2: Public Report Page. Show two reports, Date-wise with date or date-range filter, default today. Overall report for all time. Each report shows only three columns: Executive Name, Total Collection Amount, Count of Cases. Add a simple bar chart for quick comparison. Page 3: Pending Receipts. Fields: Loan Number, Pending Amount, Upload Slips, allow multiple photos at once. On submit, show confirmation popup. On confirm, upload all photos to Google Drive. Save drive links in Google Sheet with Loan Number, Pending Amount, Photo Links, Status Pending. Show pending list with a Done button. When Done is clicked, show confirmation. On confirm, remove from pending and count that amount in normal collection report, no duplicate entries. Keep UI clean and minimal, white background, simple buttons, large text for easy mobile use.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://mahavtaardailycollection.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/8068e29d-3563-4ec1-a466-0815dedd51f7).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
