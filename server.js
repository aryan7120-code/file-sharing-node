require("dotenv").config()
const multer = require("multer")
const mongoose = require("mongoose")
const bcrypt = require("bcrypt")
const File = require("./models/file")
const User = require("./models/user")
const session = require("express-session")
const express = require("express")
const app = express()

// Middleware
app.use(express.urlencoded({ extended: true }))
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === "production", httpOnly: true }
}))

// File upload handling
const upload = multer({ dest: "uploads" })

// Connect to MongoDB
mongoose.connect(process.env.DATABASE_URL, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("Error connecting to MongoDB:", err))

// Set view engine
app.set("view engine", "ejs")

// Middleware for checking if the user is logged in
function isAuthenticated(req, res, next) {
  if (req.session.userId) {
    next()
  } else {
    res.redirect("/login")
  }
}

// --------------
// Routes
// --------------

// Home page (index)
app.get("/", (req, res) => {
  res.render("index")
})

// Register route
app.get("/register", (req, res) => {
  res.render("register")
})

app.post("/register", async (req, res) => {
  try {
    const hashedPassword = await bcrypt.hash(req.body.password, 10)
    const user = await User.create({
      username: req.body.username,
      password: hashedPassword
    })
    req.session.userId = user._id // Auto-login user after registration
    res.redirect("/")
  } catch (e) {
    console.error("Error during registration:", e)
    res.redirect("/register")
  }
})

// Login route
app.get("/login", (req, res) => {
  res.render("login")
})

app.post("/login", async (req, res) => {
  try {
    const user = await User.findOne({ username: req.body.username })
    if (user && await bcrypt.compare(req.body.password, user.password)) {
      req.session.userId = user._id
      res.redirect("/")
    } else {
      res.render("login", { error: "Invalid username or password" })
    }
  } catch (e) {
    console.error("Error during login:", e)
    res.render("login", { error: "Something went wrong" })
  }
})

// Logout route
app.get("/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.redirect("/")
    }
    res.clearCookie("connect.sid")
    res.redirect("/login")
  })
})

// Upload route (only accessible by authenticated users)
app.post("/upload", isAuthenticated, upload.single("file"), async (req, res) => {
  try {
    const fileData = {
      path: req.file.path,
      originalName: req.file.originalname,
      owner: req.session.userId
    }
    if (req.body.password) {
      fileData.password = await bcrypt.hash(req.body.password, 10)
    }

    const file = await File.create(fileData)
    const fileLink = `${req.headers.origin}/file/${file.id}`

    res.render("index", { 
      fileLink,
      shareLinkEmail: `mailto:?subject=File Share&body=Download your file here: ${fileLink}`,
      shareLinkWhatsapp: `https://api.whatsapp.com/send?text=Download your file here: ${fileLink}`
    })
  } catch (e) {
    console.error("Error during file upload:", e)
    res.status(500).send("File upload failed")
  }
})

// File download route
app.route("/file/:id").get(handleDownload).post(handleDownload)

async function handleDownload(req, res) {
  try {
    const file = await File.findById(req.params.id)

    if (!file) {
      return res.status(404).send("File not found")
    }

    if (file.password) {
      if (!req.body.password) {
        return res.render("password")
      }

      if (!(await bcrypt.compare(req.body.password, file.password))) {
        return res.render("password", { error: "Incorrect password" })
      }
    }

    file.downloadCount++
    await file.save()
    res.download(file.path, file.originalName)
  } catch (e) {
    console.error("Error during file download:", e)
    res.status(500).send("Error occurred while downloading the file")
  }
}

// --------------
// Start the Server
// --------------
app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`)
})
