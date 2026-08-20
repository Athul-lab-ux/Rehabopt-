/* ================================================================
   REHABOPT — mediapipe-loader.js
   Browser-side MediaPipe Pose + Hand landmark detection.
   Uses @mediapipe/tasks-vision 0.10.14 (WASM in browser).
   ================================================================ */

const MediaPipeLoader = (() => {
    let poseLandmarker = null;
    let handLandmarker = null;
    let isRunning = false;
    let onResultsCallback = null;

    const POSE_LANDMARKS = {
        LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
        LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
        LEFT_WRIST: 15, RIGHT_WRIST: 16,
    };

    const HAND_LANDMARKS = {
        WRIST: 0, THUMB_TIP: 4, INDEX_TIP: 8,
        MIDDLE_TIP: 12, RING_TIP: 16, PINKY_TIP: 20,
    };

    // =================================================================
    // Initialize MediaPipe models
    // =================================================================
    async function init() {
        try {
            console.log("[MediaPipe] Initializing...");

            // Check if vision globals are loaded from CDN script
            const hasFilesetResolver = typeof window.FilesetResolver !== 'undefined';
            const hasPoseLandmarker = typeof window.PoseLandmarker !== 'undefined';
            const hasHandLandmarker = typeof window.HandLandmarker !== 'undefined';

            console.log("[MediaPipe] FilesetResolver:", hasFilesetResolver,
                        "PoseLandmarker:", hasPoseLandmarker,
                        "HandLandmarker:", hasHandLandmarker);

            if (!hasFilesetResolver) {
                console.error("[MediaPipe] vision_bundle.js not loaded! Trying dynamic load...");
                await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.js");
                await sleep(1000);
                if (typeof window.FilesetResolver === 'undefined') {
                    console.error("[MediaPipe] Still no FilesetResolver after dynamic load");
                    return false;
                }
            }

            // Load WASM files
            console.log("[MediaPipe] Loading WASM...");
            const vision = await window.FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
            );
            console.log("[MediaPipe] WASM loaded OK");

            // Pose landmarker
            console.log("[MediaPipe] Loading pose model...");
            poseLandmarker = await window.PoseLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task",
                    delegate: "GPU"
                },
                runningMode: "VIDEO",
                numPoses: 1,
                minPoseDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5,
            });
            console.log("[MediaPipe] Pose model loaded OK");

            // Hand landmarker
            console.log("[MediaPipe] Loading hand model...");
            handLandmarker = await window.HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                    delegate: "GPU"
                },
                runningMode: "VIDEO",
                numHands: 1,
                minHandDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5,
            });
            console.log("[MediaPipe] Hand model loaded OK");

            return true;
        } catch (err) {
            console.error("[MediaPipe] GPU failed:", err.message);
            console.log("[MediaPipe] Trying CPU fallback...");
            return await initCPU();
        }
    }

    // CPU fallback
    async function initCPU() {
        try {
            const vision = await window.FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
            );

            poseLandmarker = await window.PoseLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task",
                    delegate: "CPU"
                },
                runningMode: "VIDEO",
                numPoses: 1,
            });

            handLandmarker = await window.HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                    delegate: "CPU"
                },
                runningMode: "VIDEO",
                numHands: 1,
            });

            console.log("[MediaPipe] CPU fallback loaded OK");
            return true;
        } catch (err2) {
            console.error("[MediaPipe] CPU also failed:", err2.message);
            return false;
        }
    }

    // Helper: load script dynamically
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.crossOrigin = 'anonymous';
            s.onload = () => { console.log("[MediaPipe] Dynamic script loaded:", src); resolve(); };
            s.onerror = (e) => { console.error("[MediaPipe] Dynamic script failed:", src, e); reject(e); };
            document.head.appendChild(s);
        });
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // =================================================================
    // Start camera and detection loop
    // =================================================================
    async function start(videoElement, onResults) {
        if (isRunning) return;
        onResultsCallback = onResults;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480, facingMode: "user" }
            });
            videoElement.srcObject = stream;
            await videoElement.play();
            isRunning = true;
            console.log("[Camera] Started:", videoElement.videoWidth, "x", videoElement.videoHeight);

            const detect = () => {
                if (!isRunning) return;
                if (videoElement.readyState >= 2 && poseLandmarker && handLandmarker) {
                    const results = processFrame(videoElement);
                    if (onResultsCallback) onResultsCallback(results);
                }
                requestAnimationFrame(detect);
            };
            detect();
        } catch (err) {
            console.error("[Camera] Failed:", err);
            alert("Camera access denied. Please allow camera permission and reload.");
        }
    }

    // =================================================================
    // Stop camera
    // =================================================================
    function stop(videoElement) {
        isRunning = false;
        if (videoElement && videoElement.srcObject) {
            videoElement.srcObject.getTracks().forEach(t => t.stop());
            videoElement.srcObject = null;
        }
    }

    // =================================================================
    // Process one frame
    // =================================================================
    function processFrame(videoElement) {
        const now = performance.now();
        const result = { pose: null, hand: null, hand_side: null };

        try {
            const poseResult = poseLandmarker.detectForVideo(videoElement, now);
            if (poseResult.landmarks && poseResult.landmarks.length > 0) {
                const lm = poseResult.landmarks[0];
                result.poseAll = lm;
                result.pose = {};
                for (const [name, idx] of Object.entries(POSE_LANDMARKS)) {
                    result.pose[idx] = { x: lm[idx].x, y: lm[idx].y, z: lm[idx].z };
                }
            }
        } catch (e) {}

        try {
            const handResult = handLandmarker.detectForVideo(videoElement, now);
            if (handResult.landmarks && handResult.landmarks.length > 0) {
                const lm = handResult.landmarks[0];
                result.handAll = lm;
                result.hand = {};
                for (let i = 0; i < 21; i++) {
                    result.hand[i] = { x: lm[i].x, y: lm[i].y, z: lm[i].z };
                }
                result.hand_side = lm[17].x < lm[5].x ? "right" : "left";
            }
        } catch (e) {}

        return result;
    }

    // =================================================================
    // Draw skeleton on canvas
    // =================================================================
    function drawSkeleton(canvas, results, options = {}) {
        const ctx = canvas.getContext("2d");
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        const drawArm = options.drawArm !== false;
        const drawHand = options.drawHand !== false;

        // Hand skeleton (21 points)
        if (drawHand && results.handAll) {
            const lm = results.handAll;
            const connections = [
                [0,1],[1,2],[2,3],[3,4],
                [0,5],[5,6],[6,7],[7,8],
                [0,9],[9,10],[10,11],[11,12],
                [0,13],[13,14],[14,15],[15,16],
                [0,17],[17,18],[18,19],[19,20],
                [5,9],[9,13],[13,17],
            ];
            ctx.strokeStyle = "#00E5FF";
            ctx.lineWidth = 2;
            for (const [a, b] of connections) {
                ctx.beginPath();
                ctx.moveTo(lm[a].x * w, lm[a].y * h);
                ctx.lineTo(lm[b].x * w, lm[b].y * h);
                ctx.stroke();
            }
            for (let i = 0; i < 21; i++) {
                ctx.fillStyle = i === 0 ? "#FF0000" : "#FFFFFF";
                ctx.beginPath();
                ctx.arc(lm[i].x * w, lm[i].y * h, i === 0 ? 5 : 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Arm skeleton (shoulder → elbow → wrist)
        if (drawArm && results.poseAll) {
            const lm = results.poseAll;
            const arms = [
                { sh: 11, el: 13, wr: 15 },
                { sh: 12, el: 14, wr: 16 },
            ];
            for (const arm of arms) {
                if (lm[arm.sh] && lm[arm.el] && lm[arm.wr]) {
                    ctx.strokeStyle = "#00C853";
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.moveTo(lm[arm.sh].x * w, lm[arm.sh].y * h);
                    ctx.lineTo(lm[arm.el].x * w, lm[arm.el].y * h);
                    ctx.lineTo(lm[arm.wr].x * w, lm[arm.wr].y * h);
                    ctx.stroke();
                    for (const idx of [arm.sh, arm.el, arm.wr]) {
                        ctx.fillStyle = "#FFFF00";
                        ctx.beginPath();
                        ctx.arc(lm[idx].x * w, lm[idx].y * h, 6, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }
        }
    }

    return {
        init, start, stop, drawSkeleton,
        isRunning: () => isRunning,
        POSE_LANDMARKS, HAND_LANDMARKS,
    };
})();
