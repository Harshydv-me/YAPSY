import express from "express";
import bodyParser from "body-parser";
import session from "express-session";
import flash from "connect-flash";
import path from "path";
import { fileURLToPath } from "url";
import { error } from "console";

import pg from "pg";
const db = process.env.DATABASE_URL
  ? new pg.Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },  // required for Railway
    })
  : new pg.Client({
      user: "postgres",
      host: "localhost",
      database: "yapsy",
      password: "yourpassword",
      port: 5432,
    });

db.connect();

db.connect();
import bcrypt from 'bcrypt';

const app = express();
const port = 3000;

import { createServer } from "http";
import { Server } from "socket.io";

const server = createServer(app);
const io = new Server(server);

const userSocketMap = {}; // userId => socket.id

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  
  socket.on("join", (userId) => {       // When user joins, save their userId and socket
    userSocketMap[userId] = socket.id;
    socket.userId = userId; // Save to socket for cleanup on disconnect
    console.log(`User ${userId} joined with socket ID ${socket.id}`);
  });


  socket.on("send_message", async ({ senderId, receiverId, message }) => {     // When message is sent


    await db.query(
      "INSERT INTO messages (sender_id, receiver_id, message) VALUES ($1, $2, $3)",      // Save to datbase
      [senderId, receiverId, message]
    );

    
    const receiverSocketId = userSocketMap[receiverId];   // Send to receiver if online
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("receive_message", {
        senderId,
        message
      });
    }


  });

  
  socket.on("disconnect", () => {        // Clean up on disconnect
    if (socket.userId) { 
      delete userSocketMap[socket.userId];
      console.log(`User ${socket.userId} disconnected`);
    }
  });
});



// Setup __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Setup view engine and static files
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static("public"));

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());   
app.use(session({
  secret: "yapsysecret",
  resave: false,
  saveUninitialized: false
}));
app.use(flash());

// Make flash messages and user available to all views
app.use((req, res, next) => {
  res.locals.success_msg = req.flash("success_msg");
  res.locals.error_msg = req.flash("error_msg");
  res.locals.user = req.session.user || null;
  next();
});


app.get("/", (req, res) => {    // gets home page 
  res.render("home");
});

app.get("/signup", (req, res) => {  // gets signup page 
  res.render("signup", {
    error: null,
    success: null
  });
});


app.get("/login", (req, res) => {   //gets null page
  res.render("login" , {
    error:null,
    success:null
  });
});


app.post("/signup", async (req, res) => {                                   // user fills form and submit post request
  const { fullname, email, phone, password, confirm_password } = req.body;

  
  if (password !== confirm_password) {    // check if passwords match
    return res.render("signup", {
      error: "Passwords do not match",
      success: null
    });
  }

  try {
    
    const result = await db.query("SELECT * FROM users WHERE email = $1", [email]);  // check if user already exists
    if (result.rows.length > 0) {
      return res.render("signup", {
        error: "Email already registered",
        success: null
      });
    }

    
    const hashedPassword = await bcrypt.hash(password, 10);  // Hash the password


    // Insert user into database
    const insertQuery = `
      INSERT INTO users (fullname, email, phone, password)   
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const newUser = await db.query(insertQuery, [fullname, email, phone, hashedPassword]);

   
    req.session.user = {                   // you’re storing data in the session
      id: newUser.rows[0].id,
      fullname: newUser.rows[0].fullname,
      email: newUser.rows[0].email
    };

    // Redirect to chat
    res.redirect("/chat");

  } catch (err) {
    console.error(err);
    res.render("signup", {
      error: "Something went wrong. Please try again.",
      success: null
    });
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    // Find user by email
    const result = await db.query("SELECT * FROM users WHERE email = $1", [email]);

    // If user not found
    if (result.rows.length === 0) {
      return res.render("login", {
        error: "Invalid email or password",
        success: null
      });
    }

    const user = result.rows[0];

    
    const isMatch = await bcrypt.compare(password, user.password); // Compare entered password with hashed password
    if (!isMatch) {
      return res.render("login", {
        error: "Invalid email or password",
        success: null
      });
    }

   
    req.session.user = {   // If password matches, start session
      id: user.id,
      fullname: user.fullname,
      email: user.email
    };

    // Redirect to chat
    res.redirect("/chat");

  } catch (err) {
    console.error(err);
    res.render("login", {
      error: "Something went wrong. Please try again.",
      success: null
    });
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.redirect("/chat");
    }
    res.redirect("/"); // Redirect to home page instead of login
  });
});

app.post("/signout", async (req, res) => {
  if (!req.session.user) {
    return res.redirect("/login");
  }

  const userId = req.session.user.id;

  try {
    // Delete the user from the database
    await db.query("DELETE FROM users WHERE id = $1", [userId]);

    // Destroy session
    req.session.destroy((err) => {
      if (err) {
        console.error("Session destroy error:", err);
        return res.redirect("/chat");
      }
      res.redirect("/");
    });
  } catch (err) {
    console.error("Error deleting user:", err);
    res.redirect("/chat");
  }
});

app.get("/chat", async (req, res) => {
  if (!req.session.user) {
    req.flash("error_msg", "Please log in to access chat.");
    return res.redirect("/login");
  }

  try {
    const result = await db.query(
      "SELECT id, fullname FROM users WHERE id != $1", 
      [req.session.user.id]
    );
    res.render("chat", { users: result.rows  });
  } catch (err) {
    console.error(err);
    res.render("chat", { users: [] });
  }
});

app.get("/search-users", async (req, res) => {
  const searchQuery = req.query.q;
  const userId = req.session.user?.id;

  if (!searchQuery || !userId) {
    return res.json([]);
  }

  try {
    const result = await db.query(
      "SELECT id, fullname FROM users WHERE fullname ILIKE $1 AND id != $2",
      [`%${searchQuery}%`, userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json([]);
  }
});

app.get("/profile", async (req, res) => {
  if (!req.session.user) {
    return res.redirect("/login");
  }

  const userId = req.session.user.id;

  try {
    const result = await db.query("SELECT fullname, email, phone FROM users WHERE id = $1", [userId]);
    const user = result.rows[0];

    res.render("profile", { user });
  } catch (err) {
    console.error("Error fetching profile:", err);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/profile/edit", async (req, res) => {             // edit profile section
  if (!req.session.user) return res.redirect("/login");

  const userId = req.session.user.id;

  try {
    const result = await db.query(
      "SELECT fullname, email, phone FROM users WHERE id = $1",
      [userId]
    );
    const user = result.rows[0];
    res.render("edit-profile", { user });
  } catch (err) {
    console.error("Error loading edit page:", err);
    res.redirect("/profile");
  }
});

app.post("/profile/edit", async (req, res) => {           // submission of edit
  if (!req.session.user) return res.redirect("/login");

  const userId = req.session.user.id;
  const { fullname, email, phone } = req.body;

  try {
    await db.query(
      "UPDATE users SET fullname = $1, email = $2, phone = $3 WHERE id = $4",
      [fullname, email, phone, userId]
    );

    // Update session values too
    req.session.user.fullname = fullname;
    req.session.user.email = email;

    res.redirect("/profile");
  } catch (err) {
    console.error("Profile update error:", err);
    res.status(500).send("Failed to update profile.");
  }
});

app.get("/forgot-password", (req, res) => {                       //forget password 
  res.render("forgot-password", { error: null, success: null });
});

app.post("/forgot-password", async (req, res) => {
  const { email } = req.body;

  try {
    const result = await db.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      return res.render("forgot-password", {
        error: "No account found with that email.",
        success: null
      });
    }

    const user = result.rows[0];
    
    res.render("forgot-password", {
      error: null,
      success: `User found. <a href="/reset-password/${user.id}">Click here to reset password</a>`
    });
  } catch (err) {
    console.error("Forgot password error:", err);
    res.render("forgot-password", {
      error: "Something went wrong.",
      success: null
    });
  }
});

app.get("/reset-password/:id", async (req, res) => {                     // Route for Password Reset Form
  const userId = req.params.id;
  res.render("reset-password", { userId, error: null, success: null });
});

app.post("/reset-password/:id", async (req, res) => {
  const userId = req.params.id;
  const { password, confirm_password } = req.body;

  if (password !== confirm_password) {
    return res.render("reset-password", {
      userId,
      error: "Passwords do not match",
      success: null
    });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query("UPDATE users SET password = $1 WHERE id = $2", [hashedPassword, userId]);

    res.render("reset-password", {
      userId,
      error: null,
      success: "Password reset successful! You can now <a href='/login'>log in</a>."
    });
  } catch (err) {
    console.error("Password reset error:", err);
    res.render("reset-password", {
      userId,
      error: "Something went wrong.",
      success: null
    });
  }
});

app.get("/messages", async (req, res) => {
  const userId      = req.session.user?.id;
  const otherUserId = req.query.userId;
  if (!userId || !otherUserId) return res.status(400).json([]);

  try {
    const q = `
      SELECT id, sender_id, receiver_id, message, timestamp
      FROM messages
      WHERE (
            (sender_id   = $1 AND receiver_id = $2 AND deleted_by_sender   = FALSE)
         OR (sender_id   = $2 AND receiver_id = $1 AND deleted_by_receiver = FALSE)
      )
      ORDER BY timestamp ASC
    `;
    const result = await db.query(q, [userId, otherUserId]);
    res.json(result.rows);
  } catch (err) {
    console.error("Message fetch error:", err);
    res.status(500).json([]);
  }
});


app.get("/recent-users", async (req, res) => {  //Update your backend with a new route to fetch users the current user has chatted with
  const userId = req.session.user?.id;
  if (!userId) return res.json([]);

  try {
    const result = await db.query(`
      SELECT 
        u.id, u.fullname, MAX(m.timestamp) AS last_message_time
      FROM 
        users u
      JOIN 
        messages m ON (u.id = m.sender_id AND m.receiver_id = $1) 
                   OR (u.id = m.receiver_id AND m.sender_id = $1)
      WHERE u.id != $1
      GROUP BY u.id, u.fullname
      ORDER BY last_message_time DESC;
    `, [userId]);

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching recent users:", err);
    res.status(500).json([]);
  }
});


app.get("/user-profile", async (req, res) => {
  const userId = req.query.id;
  const q = "SELECT fullname, email, phone FROM users WHERE id = $1";
  try {
    const result = await db.query(q,[userId]);
    if (result.rows.length) return res.json(result.rows[0]);
    res.status(404).json({error:"User not found"});
  } catch(e){ console.error(e); res.status(500).json({error:"DB error"}); }
});


app.post("/delete-chat", async (req, res) => {
  const userId = req.session.user?.id;
  const partnerId = req.body.partnerId;
  if (!userId || !partnerId) return res.sendStatus(400);

  const q = `
    UPDATE messages
    SET
      deleted_by_sender   = CASE WHEN sender_id   = $1 AND receiver_id = $2 THEN TRUE ELSE deleted_by_sender   END,
      deleted_by_receiver = CASE WHEN sender_id   = $2 AND receiver_id = $1 THEN TRUE ELSE deleted_by_receiver END
    WHERE (sender_id = $1 AND receiver_id = $2)
       OR (sender_id = $2 AND receiver_id = $1)
  `;
  try {
    await db.query(q, [userId, partnerId]);
    res.sendStatus(204);        // success, nothing to return
  } catch (err) {
    console.error("delete‑chat error:", err);
    res.sendStatus(500);
  }
});



server.listen(port, () => {
  console.log(`✅ Yapsy is running on http://localhost:${port}`);
});
