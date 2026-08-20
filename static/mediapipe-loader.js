/* ================================================================
   REHABOPT — mediapipe-loader.js
   Browser-side MediaPipe Pose + Hand landmark detection.
   Uses @mediapipe/tasks-vision (WASM in browser).
   
   NO server-side processing — everything runs in the user's browser.
   Requires HTTPS for camera access (Railway provides this).
   ================================================================ */

const MediaPipeLoader = (() => {
    let poseLandmarker = null;
    let handLandmarker = null;
    let camera = null;
    let isRunning = false;
    let onResultsCallback = null;

    // MediaPipe landmark indices
    const POSE_LANDMARKS = {
        LEFT_SHOULDER: 11,
        RIGHT_SHOULDER: 12,
        LEFT_ELBOW: 13,
        RIGHT_ELBOW: 14,
        LEFT_WRIST: 15,
        RIGHT_WRIST: 16,
    };

    const HAND_LANDMARKS = {
        WRIST: 0,
        THUMB_TIP: 4,
        INDEX_TIP: 8,
        MIDDLE_TIP: 12,
        RING_TIP: 16,
        PINKY_TIP: 20,
        INDEX_MCP: 5,
        MIDDLE_MCP: 9,
        RING_MCP: 13,
        PINKY_MCP: 17,
    };

    // =================================================================
    // Initialize MediaPipe models (called once on page load)
    // =================================================================
    async function init() {
        try {
            // Dynamically import MediaPipe from CDN
            const vision = await window.FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm"
            );

            // Pose landmarker (33 body landmarks)
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

            // Hand landmarker (21 landmarks per hand)
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

            console.log("[MediaPipe] Models loaded successfully (Pose + Hand)");
            return true;
        } catch (err) {
            console.error("[MediaPipe] Failed to load models:", err);
            // Fallback: try CPU delegate
            try {
                const vision = await window.FilesetResolver.forVisionTasks(
                    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm"
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
                console.log("[MediaPipe] Models loaded (CPU fallback)");
                return true;
            } catch (err2) {
                console.error("[MediaPipe] CPU fallback also failed:", err2);
                return false;
            }
        }
    }

    // =================================================================
    // Start camera and detection loop
    // =================================================================
    async function start(videoElement, onResults) {
        if (isRunning) return;
        onResultsCallback = onResults;

        try {
            // Request camera
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480, facingMode: "user" }
            });
            videoElement.srcObject = stream;
            await videoElement.play();
            isRunning = true;
            console.log("[Camera] Started — resolution:", videoElement.videoWidth, "x", videoElement.videoHeight);

            // Detection loop
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
            console.error("[Camera] Failed to start:", err);
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
    // Process one frame — returns structured landmarks
    // =================================================================
    function processFrame(videoElement) {
        const now = performance.now();
        const result = { pose: null, hand: null, hand_side: null };

        // Pose detection
        try {
            const poseResult = poseLandmarker.detectForVideo(videoElement, now);
            if (poseResult.landmarks && poseResult.landmarks.length > 0) {
                const lm = poseResult.landmarks[0]; // first person
                result.pose = {};
                for (const [name, idx] of Object.entries(POSE_LANDMARKS)) {
                    result.pose[idx] = { x: lm[idx].x, y: lm[idx].y, z: lm[idx].z };
                }
                // All pose landmarks for drawing
                result.poseAll = lm;
            }
        } catch (e) { /* pose detection failed for this frame */ }

        // Hand detection
        try {
            const handResult = handLandmarker.detectForVideo(videoElement, now);
            if (handResult.landmarks && handResult.landmarks.length > 0) {
                const lm = handResult.landmarks[0]; // first hand
                result.hand = {};
                for (let i = 0; i < 21; i++) {
                    result.hand[i] = { x: lm[i].x, y: lm[i].y, z: lm[i].z };
                }
                // Determine which hand (mirror: left on screen = right hand)
                result.hand_side = lm[17].x < lm[5].x ? "right" : "left";
                // All hand landmarks for drawing
                result.handAll = lm;
            }
        } catch (e) { /* hand detection failed for this frame */ }

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
        const drawAngles = options.drawAngles || false;
        const angleData = options.angles || {};

        // --- Draw hand skeleton (21 points, 20 connections) ---
        if (drawHand && results.handAll) {
            const lm = results.handAll;
            const connections = [
                [0,1],[1,2],[2,3],[3,4],         // thumb
                [0,5],[5,6],[6,7],[7,8],          // index
                [0,9],[9,10],[10,11],[11,12],     // middle
                [0,13],[13,14],[14,15],[15,16],   // ring
                [0,17],[17,18],[18,19],[19,20],   // pinky
                [5,9],[9,13],[13,17],             // palm
            ];
            // Draw bones (cyan)
            ctx.strokeStyle = "#00E5FF";
            ctx.lineWidth = 2;
            for (const [a, b] of connections) {
                ctx.beginPath();
                ctx.moveTo(lm[a].x * w, lm[a].y * h);
                ctx.lineTo(lm[b].x * w, lm[b].y * h);
                ctx.stroke();
            }
            // Draw joints (white)
            for (let i = 0; i < 21; i++) {
                ctx.fillStyle = i === 0 ? "#FF0000" : "#FFFFFF";
                ctx.beginPath();
                ctx.arc(lm[i].x * w, lm[i].y * h, i === 0 ? 5 : 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // --- Draw arm skeleton (shoulder → elbow → wrist) ---
        if (drawArm && results.poseAll) {
            const lm = results.poseAll;
            // Draw both arms if available
            const arms = [
                { sh: 11, el: 13, wr: 15 }, // left
                { sh: 12, el: 14, wr: 16 }, // right
            ];
            for (const arm of arms) {
                if (lm[arm.sh] && lm[arm.el] && lm[arm.wr]) {
                    // Bones (green)
                    ctx.strokeStyle = "#00C853";
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.moveTo(lm[arm.sh].x * w, lm[arm.sh].y * h);
                    ctx.lineTo(lm[arm.el].x * w, lm[arm.el].y * h);
                    ctx.lineTo(lm[arm.wr].x * w, lm[arm.wr].y * h);
                    ctx.stroke();
                    // Joints (yellow)
                    for (const idx of [arm.sh, arm.el, arm.wr]) {
                        ctx.fillStyle = "#FFFF00";
                        ctx.beginPath();
                        ctx.arc(lm[idx].x * w, lm[idx].y * h, 6, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    // Angle labels
                    if (drawAngles) {
                        const ang = angleData[arm.el] || angleData[arm.wr];
                        if (ang !== undefined) {
                            ctx.fillStyle = "#00E5FF";
                            ctx.font = "bold 14px Segoe UI";
                            ctx.fillText(`${Math.round(ang)}°`, lm[arm.el].x * w + 10, lm[arm.el].y * h - 10);
                        }
                    }
                }
            }
        }
    }

    // =================================================================
    // Public API
    // =================================================================
    return {
        init,
        start,
        stop,
        drawSkeleton,
        isRunning: () => isRunning,
        POSE_LANDMARKS,
        HAND_LANDMARKS,
    };
})();
