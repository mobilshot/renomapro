RenomaPro MVP - upgraded with Stripe Checkout and admin panel

Structure:
- backend/ (Express + SQLite) - contains server.js, package.json
- frontend/ (static HTML/JS) - improved UI with subscription flow
- docker-compose.yml (runs both)

Quick start (requires Docker):
1. docker-compose up --build
2. Open http://localhost:8080 to view the site, backend at http://localhost:3000
3. Default admin user: email admin@renomapro.local password admin123

Stripe integration (test mode):
1. Create a Stripe account and get test secret key (sk_test_...).
2. In Stripe Dashboard create a Product and a recurring Price (monthly). Copy the Price ID (price_...).
3. Set environment variables before starting backend (docker-compose or host env):
   - STRIPE_SECRET=sk_test_...
   - STRIPE_PRICE_ID=price_...
   Optionally, set WEBHOOK_SECRET if you configure webhooks.
4. Use the 'Wykup abonament' button after registering/logging in as a fachowiec to start Checkout.

Notes:
- The backend will create a Stripe Customer for each registered user on checkout session creation.
- The webhook endpoint (/webhook) is included; to handle production webhooks configure WEBHOOK_SECRET and implement desired event handling.
- For local webhook testing use the Stripe CLI (stripe listen --forward-to localhost:3000/webhook).

Admin panel:
- Click 'Znajdź fachowca' and choose to login as admin (use default admin or created admin user).
- Admin can view leads and list of fachowcy in the simple admin panel.


Legal pages added: /regulamin.html, /polityka-prywatnosci.html, /cookies.html
Cookie banner added to frontend index.
