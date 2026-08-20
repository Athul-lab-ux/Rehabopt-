/* ================================================================
   REHABOPT — games.js
   9 hand-driven games — all running in the browser.
   Uses MediaPipe landmarks for hand/gesture input.
   ================================================================ */

const GamesEngine = (() => {

    // =================================================================
    // GAME DEFINITIONS
    // =================================================================
    const GAMES = {
        1: { name: "Star Catch",  type: "catch" },
        2: { name: "Bubble Pop",  type: "pop" },
        3: { name: "Balance Beam", type: "balance" },
        4: { name: "Track the Dot", type: "track" },
        5: { name: "Flappy Reach", type: "flappy" },
        6: { name: "Fist Pop",    type: "fistpop" },
        7: { name: "Wrist Hammer", type: "hammer" },
        8: { name: "Elbow Crusher", type: "crusher" },
        9: { name: "Pinch Pop",   type: "pinchpop" },
    };

    let game = null;
    let score = 0;
    let lives = 3;
    let paused = false;
    let running = false;
    let speedMultiplier = 1.0;

    // =================================================================
    // GAME CLASSES
    // =================================================================
    class BaseGame {
        constructor() { this.score = 0; this.paused = false; }
        pause() { this.paused = true; }
        resume() { this.paused = false; }
        restart() { this.score = 0; this.paused = false; }
        setSpeed(s) { speedMultiplier = Math.max(0.5, Math.min(3.0, s)); }
    }

    // --- Star Catch ---
    class StarCatch extends BaseGame {
        constructor() {
            super();
            this.stars = [];
            this.handX = 0.5;
            this.spawnTimer = 0;
        }
        process(lms, W, H) {
            if (this.paused) return;
            if (lms.hand && lms.hand[8]) this.handX = lms.hand[8].x;
            this.spawnTimer++;
            if (this.spawnTimer % Math.round(40 / speedMultiplier) === 0) {
                this.stars.push({ x: Math.random(), y: -0.1, speed: 0.008 * speedMultiplier });
            }
            this.stars.forEach(s => s.y += s.speed);
            this.stars = this.stars.filter(s => {
                if (s.y > 1.1) return false;
                if (Math.abs(s.x - this.handX) < 0.06 && s.y > 0.8 && s.y < 0.95) {
                    this.score += 10;
                    return false;
                }
                return true;
            });
        }
        draw(ctx, W, H) {
            ctx.fillStyle = "#FFD700";
            this.stars.forEach(s => {
                ctx.font = "24px Segoe UI";
                ctx.fillText("★", s.x * W - 12, s.y * H);
            });
        }
    }

    // --- Bubble Pop ---
    class BubblePop extends BaseGame {
        constructor() {
            super();
            this.bubbles = [];
            this.spawnTimer = 0;
        }
        process(lms, W, H) {
            if (this.paused) return;
            this.spawnTimer++;
            if (this.spawnTimer % Math.round(50 / speedMultiplier) === 0) {
                this.bubbles.push({ x: Math.random(), y: 1.1, speed: 0.005 * speedMultiplier, r: 15 + Math.random() * 10 });
            }
            this.bubbles.forEach(b => b.y -= b.speed);
            this.bubbles = this.bubbles.filter(b => {
                if (b.y < -0.1) return false;
                if (lms.hand && lms.hand[8]) {
                    const dx = b.x - lms.hand[8].x;
                    const dy = b.y - lms.hand[8].y;
                    if (Math.sqrt(dx * dx + dy * dy) < 0.06) {
                        this.score += 5;
                        return false;
                    }
                }
                return true;
            });
        }
        draw(ctx, W, H) {
            this.bubbles.forEach(b => {
                ctx.strokeStyle = "#FFA64D";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(b.x * W, b.y * H, b.r, 0, Math.PI * 2);
                ctx.stroke();
            });
        }
    }

    // --- Flappy Reach ---
    class FlappyReach extends BaseGame {
        constructor() {
            super();
            this.pillars = [];
            this.birdY = 0.5;
            this.spawnTimer = 0;
        }
        process(lms, W, H) {
            if (this.paused) return;
            // Bird follows hand Y
            if (lms.hand && lms.hand[8]) {
                this.birdY = lms.hand[8].y;
            }
            this.spawnTimer++;
            if (this.spawnTimer % Math.round(90 / speedMultiplier) === 0) {
                const gapY = 0.25 + Math.random() * 0.5;
                this.pillars.push({ x: 1.1, gapY, gapSize: 0.18, passed: false });
            }
            this.pillars.forEach(p => p.x -= 0.006 * speedMultiplier);
            this.pillars = this.pillars.filter(p => {
                if (p.x < -0.1) return false;
                // Check collision
                if (Math.abs(p.x - 0.15) < 0.06) {
                    if (this.birdY < p.gapY - p.gapSize / 2 || this.birdY > p.gapY + p.gapSize / 2) {
                        if (!p.passed) {
                            lives--;
                            p.passed = true;
                            if (lives <= 0) { this.score = 0; lives = 3; }
                        }
                    } else if (!p.passed) {
                        this.score++;
                        p.passed = true;
                    }
                }
                return true;
            });
        }
        draw(ctx, W, H) {
            // Bird
            ctx.fillStyle = "#FFD700";
            ctx.beginPath();
            ctx.arc(0.15 * W, this.birdY * H, 12, 0, Math.PI * 2);
            ctx.fill();
            // Pillars
            this.pillars.forEach(p => {
                ctx.fillStyle = "#00C853";
                const gapTop = (p.gapY - p.gapSize / 2) * H;
                const gapBot = (p.gapY + p.gapSize / 2) * H;
                ctx.fillRect(p.x * W - 15, 0, 30, gapTop);
                ctx.fillRect(p.x * W - 15, gapBot, 30, H - gapBot);
            });
        }
    }

    // --- Fist Pop ---
    class FistPop extends BaseGame {
        constructor() {
            super();
            this.balls = [];
            this.spawnTimer = 0;
            this.wasFist = false;
        }
        process(lms, W, H) {
            if (this.paused) return;
            const variance = lms.hand ? MathCore.handVariance(getHandPts(lms)) : 0.1;
            const isFist = variance < 0.05;
            // Pop one ball per fist
            if (isFist && !this.wasFist) {
                this.balls = this.balls.filter((b, i) => {
                    if (i === 0) { this.score += 10; return false; }
                    return true;
                });
            }
            this.wasFist = isFist;
            // Spawn balls
            this.spawnTimer++;
            if (this.spawnTimer % Math.round(60 / speedMultiplier) === 0 && this.balls.length < 5) {
                this.balls.push({ x: 0.2 + Math.random() * 0.6, y: 1.05, speed: 0.003 * speedMultiplier });
            }
            this.balls.forEach(b => b.y -= b.speed);
            this.balls = this.balls.filter(b => b.y > -0.1);
        }
        draw(ctx, W, H) {
            ctx.fillStyle = "#FF6B6B";
            this.balls.forEach(b => {
                ctx.beginPath();
                ctx.arc(b.x * W, b.y * H, 18, 0, Math.PI * 2);
                ctx.fill();
            });
        }
    }

    // --- Wrist Hammer ---
    class WristHammer extends BaseGame {
        constructor() {
            super();
            this.target = { x: 0.5, y: 0.5 };
            this.spawnTimer = 0;
            this.wasDown = false;
        }
        process(lms, W, H) {
            if (this.paused) return;
            // Wrist angle detection
            const angle = lms.pose ? ExerciseEngine.getWristAngle(lms) : 180;
            const isDown = angle < 160;
            if (isDown && !this.wasDown) {
                // Check if hand is near target
                if (lms.hand && lms.hand[8]) {
                    const dx = lms.hand[8].x - this.target.x;
                    const dy = lms.hand[8].y - this.target.y;
                    if (Math.sqrt(dx * dx + dy * dy) < 0.1) {
                        this.score += 15;
                    }
                }
            }
            this.wasDown = isDown;
            // Move target
            this.spawnTimer++;
            if (this.spawnTimer % Math.round(80 / speedMultiplier) === 0) {
                this.target = { x: 0.2 + Math.random() * 0.6, y: 0.3 + Math.random() * 0.4 };
            }
        }
        draw(ctx, W, H) {
            ctx.fillStyle = "#FFB300";
            ctx.beginPath();
            ctx.arc(this.target.x * W, this.target.y * H, 20, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#000";
            ctx.font = "16px Segoe UI";
            ctx.fillText("HIT", this.target.x * W - 14, this.target.y * H + 5);
        }
    }

    // --- Simple generic games for the rest ---
    class TrackDot extends BaseGame {
        constructor() { super(); this.dotX = 0.5; this.dotY = 0.5; this.t = 0; }
        process(lms, W, H) {
            if (this.paused) return;
            this.t += 0.02 * speedMultiplier;
            this.dotX = 0.5 + 0.3 * Math.cos(this.t);
            this.dotY = 0.5 + 0.3 * Math.sin(this.t * 0.7);
            if (lms.hand && lms.hand[8]) {
                const dx = lms.hand[8].x - this.dotX;
                const dy = lms.hand[8].y - this.dotY;
                if (Math.sqrt(dx * dx + dy * dy) < 0.05) this.score++;
            }
        }
        draw(ctx, W, H) {
            ctx.fillStyle = "#FF7A00";
            ctx.beginPath();
            ctx.arc(this.dotX * W, this.dotY * H, 14, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    class BalanceBeam extends BaseGame {
        constructor() { super(); this.ballX = 0.5; this.targetX = 0.5; this.t = 0; }
        process(lms, W, H) {
            if (this.paused) return;
            this.t += 0.015 * speedMultiplier;
            this.targetX = 0.5 + 0.35 * Math.sin(this.t);
            if (lms.hand && lms.hand[8]) {
                this.ballX = lms.hand[8].x;
                if (Math.abs(this.ballX - this.targetX) < 0.04) this.score++;
            }
        }
        draw(ctx, W, H) {
            // Beam
            ctx.strokeStyle = "#8A7A66";
            ctx.lineWidth = 4;
            ctx.beginPath(); ctx.moveTo(0, H * 0.5); ctx.lineTo(W, H * 0.5); ctx.stroke();
            // Target
            ctx.fillStyle = "#00D4AA";
            ctx.beginPath(); ctx.arc(this.targetX * W, H * 0.5, 12, 0, Math.PI * 2); ctx.fill();
            // Ball
            ctx.fillStyle = "#FF7A00";
            ctx.beginPath(); ctx.arc(this.ballX * W, H * 0.5, 10, 0, Math.PI * 2); ctx.fill();
        }
    }

    class ElbowCrusher extends BaseGame {
        constructor() { super(); this.blocks = []; this.spawnTimer = 0; this.wasBent = false; }
        process(lms, W, H) {
            if (this.paused) return;
            const angle = lms.pose ? ExerciseEngine.getElbowAngle(lms) : 180;
            const isBent = angle < 100;
            if (isBent && !this.wasBent) {
                this.blocks = this.blocks.filter((b, i) => { if (i === 0) { this.score += 10; return false; } return true; });
            }
            this.wasBent = isBent;
            this.spawnTimer++;
            if (this.spawnTimer % Math.round(50 / speedMultiplier) === 0 && this.blocks.length < 4) {
                this.blocks.push({ x: 0.2 + Math.random() * 0.6, y: -0.05 });
            }
            this.blocks.forEach(b => b.y += 0.004 * speedMultiplier);
            this.blocks = this.blocks.filter(b => b.y < 1.1);
        }
        draw(ctx, W, H) {
            ctx.fillStyle = "#E5484D";
            this.blocks.forEach(b => ctx.fillRect(b.x * W - 20, b.y * H - 15, 40, 30));
        }
    }

    class PinchPop extends BaseGame {
        constructor() { super(); this.balls = []; this.spawnTimer = 0; this.wasPinch = false; }
        process(lms, W, H) {
            if (this.paused) return;
            let isPinch = false;
            if (lms.hand && lms.hand[4] && lms.hand[8]) {
                isPinch = MathCore.l2Distance([lms.hand[4].x, lms.hand[4].y], [lms.hand[8].x, lms.hand[8].y]) < 0.04;
            }
            if (isPinch && !this.wasPinch) {
                this.balls = this.balls.filter((b, i) => { if (i === 0) { this.score += 10; return false; } return true; });
            }
            this.wasPinch = isPinch;
            this.spawnTimer++;
            if (this.spawnTimer % Math.round(55 / speedMultiplier) === 0 && this.balls.length < 5) {
                this.balls.push({ x: 0.15 + Math.random() * 0.7, y: 1.05, speed: 0.004 * speedMultiplier });
            }
            this.balls.forEach(b => b.y -= b.speed);
            this.balls = this.balls.filter(b => b.y > -0.1);
        }
        draw(ctx, W, H) {
            ctx.fillStyle = "#8B5CF6";
            this.balls.forEach(b => { ctx.beginPath(); ctx.arc(b.x * W, b.y * H, 16, 0, Math.PI * 2); ctx.fill(); });
        }
    }

    // Helper for games
    function getHandPts(lms) {
        if (!lms || !lms.hand) return [];
        const pts = [];
        for (let i = 0; i < 21; i++) {
            if (lms.hand[i]) pts.push([lms.hand[i].x, lms.hand[i].y]);
        }
        return pts;
    }

    // =================================================================
    // PUBLIC API
    // =================================================================
    function startGame(num) {
        const info = GAMES[num];
        if (!info) return;
        switch (info.type) {
            case "catch": game = new StarCatch(); break;
            case "pop": game = new BubblePop(); break;
            case "flappy": game = new FlappyReach(); break;
            case "fistpop": game = new FistPop(); break;
            case "hammer": game = new WristHammer(); break;
            case "track": game = new TrackDot(); break;
            case "balance": game = new BalanceBeam(); break;
            case "crusher": game = new ElbowCrusher(); break;
            case "pinchpop": game = new PinchPop(); break;
            default: game = new StarCatch();
        }
        score = 0;
        lives = 3;
        paused = false;
        running = true;
        speedMultiplier = 1.0;
    }

    function process(lms, W, H) {
        if (!game || paused) return;
        game.process(lms, W, H);
        score = game.score;
    }

    function draw(ctx, W, H) {
        if (!game) return;
        game.draw(ctx, W, H);
    }

    function pause() { paused = true; if (game) game.paused = true; }
    function resume() { paused = false; if (game) game.paused = false; }
    function restart() { if (game) game.restart(); score = 0; lives = 3; paused = false; }
    function setSpeed(s) { speedMultiplier = Math.max(0.5, Math.min(3.0, s)); if (game) game.setSpeed(s); }
    function stopGame() { running = false; game = null; }

    return {
        GAMES,
        startGame, process, draw,
        pause, resume, restart, setSpeed, stopGame,
        getState: () => ({ score, lives, paused, speed: speedMultiplier, running }),
    };
})();
