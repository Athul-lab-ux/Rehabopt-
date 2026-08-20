/* ================================================================
   REHABOPT — drawing.js
   9 parametric shapes to trace + custom drawing canvas.
   All running in the browser.
   ================================================================ */

const DrawingEngine = (() => {

    // =================================================================
    // SHAPE DEFINITIONS — parametric curves
    // =================================================================
    const SHAPES = [
        { name: "Circle",    fn: (t) => [0.5 + 0.35 * Math.cos(t * 2 * Math.PI), 0.5 + 0.35 * Math.sin(t * 2 * Math.PI)] },
        { name: "Square",    fn: (t) => {
            const s = t * 4;
            if (s < 1) return [0.15 + s * 0.7, 0.15];
            if (s < 2) return [0.85, 0.15 + (s-1) * 0.7];
            if (s < 3) return [0.85 - (s-2) * 0.7, 0.85];
            return [0.15, 0.85 - (s-3) * 0.7];
        }},
        { name: "Triangle", fn: (t) => {
            const s = t * 3;
            if (s < 1) return [0.5 + s * 0.35, 0.85 - s * 0.7];
            if (s < 2) return [0.85 - (s-1) * 0.7, 0.15 + (s-1) * 0.7];
            return [0.15 + (s-2) * 0.35, 0.85];
        }},
        { name: "Star", fn: (t) => {
            const angle = t * 2 * Math.PI - Math.PI / 2;
            const r = t % 0.2 < 0.1 ? 0.35 : 0.15;
            return [0.5 + r * Math.cos(angle), 0.5 + r * Math.sin(angle)];
        }},
        { name: "Heart", fn: (t) => {
            const angle = t * 2 * Math.PI;
            const x = 16 * Math.pow(Math.sin(angle), 3);
            const y = -(13 * Math.cos(angle) - 5 * Math.cos(2*angle) - 2 * Math.cos(3*angle) - Math.cos(4*angle));
            return [0.5 + x * 0.018, 0.5 - y * 0.018];
        }},
        { name: "Rectangle", fn: (t) => {
            const s = t * 4;
            if (s < 1) return [0.15 + s * 0.7, 0.25];
            if (s < 2) return [0.85, 0.25 + (s-1) * 0.5];
            if (s < 3) return [0.85 - (s-2) * 0.7, 0.75];
            return [0.15, 0.75 - (s-3) * 0.5];
        }},
        { name: "Pentagon", fn: (t) => {
            const angle = t * 2 * Math.PI - Math.PI / 2;
            return [0.5 + 0.35 * Math.cos(angle), 0.5 + 0.35 * Math.sin(angle)];
        }},
        { name: "Hexagon", fn: (t) => {
            const angle = t * 2 * Math.PI;
            return [0.5 + 0.35 * Math.cos(angle), 0.5 + 0.35 * Math.sin(angle)];
        }},
        { name: "Diamond", fn: (t) => {
            const s = t * 4;
            if (s < 1) return [0.5 + s * 0.35, 0.15 + s * 0.35];
            if (s < 2) return [0.85 - (s-1) * 0.35, 0.5 + (s-1) * 0.35];
            if (s < 3) return [0.5 - (s-2) * 0.35, 0.85 - (s-2) * 0.35];
            return [0.15 + (s-3) * 0.35, 0.5 - (s-3) * 0.35];
        }},
    ];

    // =================================================================
    // STATE
    // =================================================================
    let mode = "trace"; // trace or custom
    let shapeIdx = 0;
    let drawing = false; // custom mode: currently drawing
    let erasing = false;
    let color = "#00D4AA";
    let progress = 0;
    let handPath = []; // user's drawn path
    let shapePoints = []; // reference shape points
    let matchCount = 0;
    let totalPoints = 0;
    let paused = false;
    let running = false;

    // =================================================================
    // INIT — generate shape reference points
    // =================================================================
    function initShape(idx) {
        shapeIdx = idx || 0;
        const shape = SHAPES[shapeIdx];
        shapePoints = [];
        for (let i = 0; i <= 100; i++) {
            shapePoints.push(shape.fn(i / 100));
        }
        handPath = [];
        matchCount = 0;
        totalPoints = shapePoints.length;
        progress = 0;
    }

    // =================================================================
    // UPDATE — called every frame with hand landmarks
    // =================================================================
    function update(lms, W, H) {
        if (!running || paused) return;
        if (!lms || !lms.hand) return;

        const tip = lms.hand[8]; // index finger tip
        if (!tip) return;

        if (mode === "custom") {
            if (drawing && !erasing) {
                handPath.push({ x: tip.x, y: tip.y, color });
            }
            return;
        }

        // Trace mode: check how close finger is to the shape
        const fingerPos = [tip.x, tip.y];
        let minDist = Infinity;
        for (const sp of shapePoints) {
            const d = MathCore.l2Distance(fingerPos, sp);
            if (d < minDist) minDist = d;
        }

        // If close to shape path, count as matched
        if (minDist < 0.08) {
            handPath.push({ x: tip.x, y: tip.y });
            // Count matching points
            matchCount = 0;
            for (const sp of shapePoints) {
                let closest = Infinity;
                for (const hp of handPath) {
                    const d = MathCore.l2Distance([hp.x, hp.y], sp);
                    if (d < closest) closest = d;
                }
                if (closest < 0.08) matchCount++;
            }
            progress = Math.round((matchCount / totalPoints) * 100);
        }
    }

    // =================================================================
    // DRAW — render on canvas
    // =================================================================
    function draw(canvas) {
        const ctx = canvas.getContext("2d");
        const W = canvas.width;
        const H = canvas.height;
        ctx.clearRect(0, 0, W, H);

        // Background
        ctx.fillStyle = "#1A1A2E";
        ctx.fillRect(0, 0, W, H);

        if (mode === "trace") {
            // Draw reference shape (dashed)
            const shape = SHAPES[shapeIdx];
            ctx.strokeStyle = "rgba(0, 212, 170, 0.3)";
            ctx.lineWidth = 3;
            ctx.setLineDash([8, 6]);
            ctx.beginPath();
            for (let i = 0; i <= 100; i++) {
                const [x, y] = shape.fn(i / 100);
                i === 0 ? ctx.moveTo(x * W, y * H) : ctx.lineTo(x * W, y * H);
            }
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw user's path
            if (handPath.length > 1) {
                ctx.strokeStyle = progress >= 90 ? "#00D4AA" : "#FF7A00";
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.moveTo(handPath[0].x * W, handPath[0].y * H);
                for (let i = 1; i < handPath.length; i++) {
                    ctx.lineTo(handPath[i].x * W, handPath[i].y * H);
                }
                ctx.stroke();
            }

            // Progress text
            ctx.fillStyle = progress >= 90 ? "#00D4AA" : "#FF7A00";
            ctx.font = "bold 28px Segoe UI";
            ctx.fillText(`${progress}%`, 20, 40);
            ctx.font = "14px Segoe UI";
            ctx.fillText(SHAPES[shapeIdx].name, 20, 60);

        } else {
            // Custom drawing mode
            for (let i = 1; i < handPath.length; i++) {
                ctx.strokeStyle = handPath[i].color || "#00D4AA";
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(handPath[i-1].x * W, handPath[i-1].y * H);
                ctx.lineTo(handPath[i].x * W, handPath[i].y * H);
                ctx.stroke();
            }
        }
    }

    // =================================================================
    // CONTROLS
    // =================================================================
    function start(m) { mode = m || "trace"; running = true; paused = false; initShape(0); handPath = []; }
    function stop() { running = false; handPath = []; }
    function pause() { paused = true; }
    function resume() { paused = false; }
    function nextShape() { shapeIdx = (shapeIdx + 1) % SHAPES.length; initShape(shapeIdx); handPath = []; }
    function setMode(m) { mode = m; handPath = []; }
    function setColor(c) { color = c; }
    function setErase(e) { erasing = e; drawing = !e; }
    function startDraw() { drawing = true; erasing = false; }
    function startErase() { erasing = true; drawing = false; }
    function clearCanvas() { handPath = []; progress = 0; matchCount = 0; }

    return {
        SHAPES,
        update, draw,
        start, stop, pause, resume,
        nextShape, setMode, setColor, setErase, startDraw, startErase, clearCanvas,
        getState: () => ({
            mode, shape: SHAPES[shapeIdx] ? SHAPES[shapeIdx].name : "—",
            progress, running, paused, color,
        }),
    };
})();
