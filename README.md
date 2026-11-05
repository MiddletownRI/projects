# Projects in Motion — prototype

Prototype rebuild of the Town of Middletown, RI project database, for review by the Town Administrator.

- **Public view** (`index.html`): projects with status, budget and progress; search, department and status filters; a printable one-page-per-project report.
- **Department updates** (`manage.html`): the update form with every field from the rebuild spec, including Project Status, % Complete, Original budget, Current spend, Final cost, Budget status and the Capital Improvement Program (CIP) reference number.

## Data

`data/projects.json` holds the 18 projects published on the current Wix page, exported Nov 5, 2026. The 10 unpublished projects are left out.

Statuses were mapped from the current site for the demo (Planning → Not started, In Progress → On track; On Budget → Within budget). Departments should confirm each project. CIP numbers, % complete and dollar amounts are blank until departments or Finance supply them.

## Prototype limits

Edits on the department page save only in the browser that made them. In production, edits go to a shared store with Town Microsoft 365 sign-in.

Hosted free on GitHub Pages. Static files only: no server, no build step.
