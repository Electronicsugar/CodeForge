const jwt = require("jsonwebtoken");
const { redisClient } = require('../config/redis');
const registerBattleSocket = require("./battle.socket");
const { setIO } = require("./socketManager");

const setupSocket = (io) => {

    setIO(io);

    // Socket authentication middleware
    io.use(async (socket, next) => {

        try{

            const authHeader = socket.handshake.headers?.authorization;
            const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : authHeader;

            const token = socket.handshake.auth?.token || 
                          socket.handshake.query?.token || 
                          socket.handshake.headers?.token ||
                          bearerToken;

            if(!token) return next(new Error("Authentication token missing"));

            // check blacklist
            if (!redisClient.isReady) return next(new Error('Session verification temporarily unavailable'));
            const isBlacklisted = await redisClient.get(`blacklist:${token}`);
            if(isBlacklisted) return next(new Error("Token has need revoked"))

            // Verify JWT
            const decoded = jwt.verify( token, process.env.JWT_SECRET);

            // Store authenticated user on socket
            socket.user = decoded;
            socket.token = token;
            socket.data.userId=decoded.id;

            next();

        } catch(error) {
            console.error("Socket authentication failed:", error.message);
            next(new Error("Invalid or expired token"));
        }
    });

    // Socket connection
    io.on("connection", (socket) => {

        console.log(`Socket connected: ${socket.id}`);

        console.log(`User connected: ${socket.user.id}`);
        socket.join(`user:${socket.user.id}`);
        socket.use(async (_packet,next)=>{
            try{
                jwt.verify(socket.token,process.env.JWT_SECRET);
                if(!redisClient.isReady)throw Error('Session temporarily unavailable');
                if(await redisClient.get(`blacklist:${socket.token}`))throw Error('Session expired');
                next();
            }catch{next(new Error('Session verification failed'));}
        });
        socket.on('error',()=>socket.emit('battle_room_error',{message:'Session verification failed. Reconnect and sign in again.'}));

        // Register battle events
        registerBattleSocket(io, socket);
        require('./battleRoom.socket')(io,socket);

        // Disconnect
        socket.on("disconnect", (reason) => {
            console.log(`Socket disconnected: ${socket.id}`, reason)

            // Remove from matchmaking queue
            const matchmakingService = require("../services/matchmaking.service");

            matchmakingService.removeFromQueue(socket.user.id);
        });

    })
}

module.exports = setupSocket;
