// RenomaPro backend - upgraded with Stripe Checkout for subscriptions and admin endpoints
// Run: npm install && npm start (or use Docker as provided)
// Required env vars for Stripe integration (test mode):
// STRIPE_SECRET - your Stripe secret key (sk_test_...)
// STRIPE_PRICE_ID - price ID for subscription (created in Stripe dashboard, e.g., price_...)
// WEBHOOK_SECRET (optional) - Stripe webhook signing secret for production/webhooks handling

const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const nodemailer = require('nodemailer');
const path = require('path');
const Stripe = require('stripe');
const app = express();
const SECRET = process.env.JWT_SECRET || 'change_this_secret';
const STRIPE_SECRET = process.env.STRIPE_SECRET || '';
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || '';

const stripe = STRIPE_SECRET ? Stripe(STRIPE_SECRET) : null;

app.use(bodyParser.json());
app.use(function(req,res,next){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  next();
});

// DB init
const dbFile = path.join(__dirname,'data.db');
const db = new sqlite3.Database(dbFile);
db.serialize(()=>{
  db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE, password TEXT, role TEXT, stripe_customer_id TEXT, subscribed INTEGER DEFAULT 0)`);
  db.run(`CREATE TABLE IF NOT EXISTS fachowcy (id INTEGER PRIMARY KEY, name TEXT, category TEXT, phone TEXT, city TEXT, verified INTEGER DEFAULT 0, about TEXT, user_id INTEGER)`);
  db.run(`CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY, name TEXT, phone TEXT, desc TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  // seed admin
  db.get("SELECT COUNT(*) as c FROM users", (err,row)=>{ if(row && row.c==0){ const pw=bcrypt.hashSync('admin123',10); db.run('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)', ['Admin','admin@renomapro.local',pw,'admin']); }});
});

// helpers
function authMiddleware(req,res,next){
  const h = req.headers.authorization;
  if(!h) return res.status(401).json({error:'no token'});
  const token = h.split(' ')[1];
  try{
    const payload = jwt.verify(token, SECRET);
    req.user = payload;
    next();
  }catch(e){ res.status(401).json({error:'invalid token'}); }
}

function adminMiddleware(req,res,next){
  if(!req.user) return res.status(401).json({error:'no token'});
  db.get('SELECT role FROM users WHERE id=?',[req.user.id], (err,row)=>{
    if(err||!row) return res.status(403).json({error:'forbidden'});
    if(row.role!=='admin') return res.status(403).json({error:'forbidden'});
    next();
  });
}

// auth routes
app.post('/api/register', (req,res)=>{
  const {name,email,password,role} = req.body;
  if(!email||!password) return res.status(400).json({error:'missing'});
  const hash = bcrypt.hashSync(password,10);
  db.run('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)',[name,email,hash,role||'pro'], function(err){
    if(err) return res.status(400).json({error:err.message});
    const id=this.lastID;
    const token = jwt.sign({id,email,role:role||'pro'}, SECRET, {expiresIn:'7d'});
    res.json({token,id});
  });
});

app.post('/api/login',(req,res)=>{
  const {email,password} = req.body;
  db.get('SELECT * FROM users WHERE email=?',[email], (err,row)=>{
    if(!row) return res.status(400).json({error:'no user'});
    if(!bcrypt.compareSync(password,row.password)) return res.status(400).json({error:'bad pass'});
    const token = jwt.sign({id:row.id,email:row.email,role:row.role}, SECRET, {expiresIn:'7d'});
    res.json({token,role:row.role,subscribed:row.subscribed});
  });
});

// list fachowcy (public)
app.get('/api/fachowcy',(req,res)=>{
  db.all('SELECT * FROM fachowcy', (err,rows)=>{ res.json(rows); });
});

// create fachowiec (protected)
app.post('/api/fachowcy', authMiddleware, (req,res)=>{
  const {name,category,phone,city,about} = req.body;
  db.run('INSERT INTO fachowcy (name,category,phone,city,about,user_id) VALUES (?,?,?,?,?,?)',[name,category,phone,city,about, req.user.id], function(err){
    if(err) return res.status(400).json({error:err.message});
    res.json({id:this.lastID});
  });
});

// update fachowca (protected)
app.put('/api/fachowcy/:id', authMiddleware, (req,res)=>{
  const id = req.params.id;
  const {name,category,phone,city,about,verified} = req.body;
  db.run('UPDATE fachowcy SET name=?,category=?,phone=?,city=?,about=?,verified=? WHERE id=?',[name,category,phone,city,about,verified?1:0,id], function(err){
    if(err) return res.status(400).json({error:err.message});
    res.json({changes:this.changes});
  });
});

// delete (protected)
app.delete('/api/fachowcy/:id', authMiddleware, (req,res)=>{
  const id=req.params.id;
  db.run('DELETE FROM fachowcy WHERE id=?',[id], function(err){
    if(err) return res.status(400).json({error:err.message});
    res.json({deleted:this.changes});
  });
});

// leads (from frontend form)
app.post('/api/leads', (req,res)=>{
  const {name,phone,desc} = req.body;
  db.run('INSERT INTO leads (name,phone,desc) VALUES (?,?,?)',[name,phone,desc], function(err){
    if(err) return res.status(400).json({error:err.message});
    // send email via nodemailer if SMTP env variables set
    if(process.env.SMTP_HOST){
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT||587,
        secure: process.env.SMTP_SECURE==='true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
      const mailOptions = { from: process.env.SMTP_FROM||'no-reply@renomapro.local', to: process.env.NOTIFY_EMAIL||process.env.SMTP_FROM, subject:'Nowe zgłoszenie', text:`Nowe zgłoszenie:\\n${name}\\n${phone}\\n${desc}`};
      transporter.sendMail(mailOptions).catch(e=>console.error('mail error',e));
    }
    res.json({id:this.lastID});
  });
});

// admin endpoints
app.get('/api/admin/leads', authMiddleware, adminMiddleware, (req,res)=>{
  db.all('SELECT * FROM leads ORDER BY created_at DESC', (err,rows)=>{ res.json(rows); });
});

app.get('/api/admin/fachowcy', authMiddleware, adminMiddleware, (req,res)=>{
  db.all('SELECT * FROM fachowcy ORDER BY id DESC', (err,rows)=>{ res.json(rows); });
});

// Stripe checkout session creation (subscription)
// Requires STRIPE_SECRET and STRIPE_PRICE_ID set in env
app.post('/api/create-checkout-session', authMiddleware, async (req,res)=>{
  if(!stripe) return res.status(500).json({error:'Stripe not configured on server'});
  const {successUrl, cancelUrl} = req.body;
  try{
    // create or fetch Stripe customer for user
    const userId = req.user.id;
    db.get('SELECT stripe_customer_id,email FROM users WHERE id=?',[userId], async (err,row)=>{
      try{
        let customerId = row && row.stripe_customer_id;
        if(!customerId){
          const cust = await stripe.customers.create({email: row ? row.email : undefined, metadata:{user_id:userId}});
          customerId = cust.id;
          db.run('UPDATE users SET stripe_customer_id=? WHERE id=?',[customerId,userId]);
        }
        // create Checkout session for subscription
        const session = await stripe.checkout.sessions.create({
          mode: 'subscription',
          payment_method_types:['card'],
          customer: customerId,
          line_items: [{price: process.env.STRIPE_PRICE_ID, quantity: 1}],
          success_url: successUrl || (req.headers.origin + '/?checkout=success'),
          cancel_url: cancelUrl || (req.headers.origin + '/?checkout=cancel'),
        });
        res.json({url: session.url});
      }catch(e){
        console.error('stripe error',e);
        res.status(500).json({error:'Stripe error'});
      }
    });
  }catch(e){ res.status(500).json({error:'server error'}); }
});

// Stripe webhook endpoint (optional) - supports invoice.payment_succeeded to mark subscribed users
app.post('/webhook', bodyParser.raw({type: 'application/json'}), (req,res)=>{
  if(!stripe) return res.status(500).send('stripe not configured');
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.WEBHOOK_SECRET || '';
  let event = null;
  try{
    if(webhookSecret){
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      event = req.body; // unsafe for production but ok for local testing if you disable signing in Stripe CLI
    }
  }catch(err){
    console.error('Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  // handle event types
  if(event && event.type === 'checkout.session.completed'){
    const session = event.data.object;
    // optional: mark user as subscribed if needed (requires mapping customer -> user)
    // For production, use invoice.payment_succeeded or customer.subscription.created
  }
  if(event && event.type === 'invoice.payment_succeeded'){
    const inv = event.data.object;
    const customerId = inv.customer;
    // mark users with this stripe_customer_id as subscribed
    db.run('UPDATE users SET subscribed=1 WHERE stripe_customer_id=?',[customerId]);
  }
  res.json({received:true});
});


// ===== OWNER DASHBOARD ENDPOINTS =====
app.get('/api/owner/stats', authMiddleware, adminMiddleware, (req,res)=>{
  db.get('SELECT COUNT(*) as count FROM users', (e,u)=>{
    db.get('SELECT COUNT(*) as count FROM fachowcy', (e2,f)=>{
      db.get('SELECT COUNT(*) as count FROM leads', (e3,l)=>{
        db.get('SELECT COUNT(*) as count FROM users WHERE subscribed=1', (e4,s)=>{
          res.json({
            users: u ? u.count : 0,
            fachowcy: f ? f.count : 0,
            leads: l ? l.count : 0,
            subscribers: s ? s.count : 0
          });
        });
      });
    });
  });
});

app.get('/api/owner/leads', authMiddleware, adminMiddleware, (req,res)=>{
  db.all('SELECT * FROM leads ORDER BY created_at DESC', (err,rows)=>{ if(err) return res.status(500).json({error:err.message}); res.json(rows); });
});

app.get('/api/owner/payments', authMiddleware, adminMiddleware, (req,res)=>{
  db.all('SELECT id,name,email,stripe_customer_id,subscribed FROM users WHERE subscribed=1 OR stripe_customer_id IS NOT NULL', (err,rows)=>{
    if(err) return res.status(500).json({error:err.message});
    res.json(rows);
  });
});
// ===== END OWNER DASHBOARD ENDPOINTS =====


// ===== REVIEW SYSTEM =====
db.run(`CREATE TABLE IF NOT EXISTS opinions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fachowiec_id INTEGER,
    client_id INTEGER,
    rating INTEGER,
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Add a review
app.post('/api/opinions', authMiddleware, (req,res)=>{
    if(req.user.role!=='client') return res.status(403).json({error:'clients only'});
    const {fachowiec_id, rating, comment} = req.body;
    db.run("INSERT INTO opinions (fachowiec_id, client_id, rating, comment) VALUES (?,?,?,?)",
        [fachowiec_id, req.user.id, rating, comment],
        function(err){
            if(err) return res.status(400).json({error:err.message});
            res.json({id:this.lastID});
        });
});

// Get reviews for a fachowiec
app.get('/api/opinions/:fachowiec_id', (req,res)=>{
    db.all("SELECT * FROM opinions WHERE fachowiec_id=?", [req.params.fachowiec_id],
        (err,rows)=>{
            if(err) return res.status(500).json({error:err.message});
            res.json(rows);
        });
});
// ===== END REVIEWS =====


// serve static frontend if present
app.use('/', express.static(path.join(__dirname,'../frontend')));

const port = process.env.PORT||3000;
app.listen(port, ()=> console.log('Server listening on',port));
