const { tunnel: cloudflaredTunnel } = require("cloudflared")
const cookieParser = require("cookie-parser")
const socketIO = require("socket.io")
const config = require("./config")
const express = require("express")
const tarkine = require("tarkine")
const http = require('http')

const app = express()
const server = http.createServer(app)
const io = new socketIO.Server(server)
const PORT = process.env.PORT || config.port

/* The tunnel URL is only known after cloudflared has provisioned it, which
   happens *after* listen(). Until then views still need an absolute, usable
   endpoint, so seed it with the local address and upgrade it once ready. */
global.remoteURL = `http://localhost:${PORT}`
global.IO = io

app.set("view engine", "html")
app.engine("html", tarkine.renderFile)
app.use(cookieParser())
app.use(express.urlencoded({ extended: false }))
app.use(express.static(__dirname + "/public"))
app.use(express.json())

app.use("/", require("./router"))

server.listen(PORT, async () => {
    const localURL = global.remoteURL
    global.remoteURL = await cloudflaredTunnel({
        "--url": localURL
    }).url

    console.log(`LOCAL  : ${localURL}`)
    console.log(`REMOTE : ${remoteURL}`)
})