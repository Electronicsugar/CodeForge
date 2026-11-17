const express = require("express");

const battleController = require("../controllers/battle.controller");
const { authMiddleware } = require("../middlewares/auth.middleware");

const router = express.Router();
router.use('/rooms',require('./battleRoom.routes'));

router.post("/", authMiddleware, battleController.createBattle);

router.get("/:battleId/analysis", authMiddleware, require("../controllers/analysis.controller").getBattleAnalysis);

router.get("/:battleId", authMiddleware, battleController.getBattleById);

module.exports = router;
