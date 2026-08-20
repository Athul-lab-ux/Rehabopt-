/* ================================================================
   REHABOPT — exercise.js
   10 guided exercises with step-locked rep counting.
   All detection is rule-based math (thresholds on angles, distances).
   Runs entirely in the browser.
   ================================================================ */

const ExerciseEngine = (() => {

    // =================================================================
    // EXERCISE DEFINITIONS — each has steps with detection rules
    // =================================================================
    const EXERCISES = {
        fist_clench: {
            name: "Fist Clench", cat: "wrist_finger",
            metric_label: "VARIANCE", skeleton: "hand",
            steps: [
                { name: "Open hand", detect: (lms) => MathCore.handVariance(getHandPts(lms)) > 0.08 },
                { name: "Curl fingers", detect: (lms) => MathCore.handVariance(getHandPts(lms)) < 0.05 },
                { name: "Hold fist", detect: (lms) => MathCore.handVariance(getHandPts(lms)) < 0.05, hold: 1.5 },
                { name: "Release", detect: (lms) => MathCore.handVariance(getHandPts(lms)) > 0.08 },
            ],
        },
        finger_spread: {
            name: "Finger Spread", cat: "wrist_finger",
            metric_label: "VARIANCE", skeleton: "hand",
            steps: [
                { name: "Relax hand", detect: (lms) => MathCore.handVariance(getHandPts(lms)) > 0.04 },
                { name: "Spread wide", detect: (lms) => MathCore.handVariance(getHandPts(lms)) > 0.10 },
                { name: "Hold spread", detect: (lms) => MathCore.handVariance(getHandPts(lms)) > 0.10, hold: 1.5 },
                { name: "Relax", detect: (lms) => MathCore.handVariance(getHandPts(lms)) < 0.08 },
            ],
        },
        wrist_flexion: {
            name: "Wrist Flexion", cat: "wrist_finger",
            metric_label: "WRIST ANGLE", skeleton: "hand",
            steps: [
                { name: "Neutral wrist", detect: (lms) => { const a = wristAngle(lms); return a > 160 && a < 200; }},
                { name: "Flex up", detect: (lms) => wristAngle(lms) > 200 },
                { name: "Hold", detect: (lms) => wristAngle(lms) > 200, hold: 1.5 },
                { name: "Return neutral", detect: (lms) => { const a = wristAngle(lms); return a > 160 && a < 200; }},
            ],
        },
        wrist_extension: {
            name: "Wrist Extension", cat: "wrist_finger",
            metric_label: "WRIST ANGLE", skeleton: "hand",
            steps: [
                { name: "Neutral wrist", detect: (lms) => { const a = wristAngle(lms); return a > 160 && a < 200; }},
                { name: "Extend down", detect: (lms) => wristAngle(lms) < 160 },
                { name: "Hold", detect: (lms) => wristAngle(lms) < 160, hold: 1.5 },
                { name: "Return neutral", detect: (lms) => { const a = wristAngle(lms); return a > 160 && a < 200; }},
            ],
        },
        thumb_touch: {
            name: "Thumb Touch", cat: "wrist_finger",
            metric_label: "DISTANCE", skeleton: "hand",
            steps: [
                { name: "Open hand", detect: (lms) => fingerDist(lms, 4, 8) > 0.06 },
                { name: "Thumb→Index", detect: (lms) => fingerDist(lms, 4, 8) < 0.04 },
                { name: "Hold touch", detect: (lms) => fingerDist(lms, 4, 8) < 0.04, hold: 1.0 },
                { name: "Release", detect: (lms) => fingerDist(lms, 4, 8) > 0.06 },
            ],
        },
        finger_pinch: {
            name: "Finger Pinch", cat: "wrist_finger",
            metric_label: "DISTANCE", skeleton: "hand",
            steps: [
                { name: "Open hand", detect: (lms) => fingerDist(lms, 8, 12) > 0.05 },
                { name: "Pinch index+middle", detect: (lms) => fingerDist(lms, 8, 12) < 0.03 },
                { name: "Hold pinch", detect: (lms) => fingerDist(lms, 8, 12) < 0.03, hold: 1.0 },
                { name: "Release", detect: (lms) => fingerDist(lms, 8, 12) > 0.05 },
            ],
        },
        elbow_flexion: {
            name: "Elbow Flexion", cat: "elbow_shoulder",
            metric_label: "ELBOW ANGLE", skeleton: "arm",
            steps: [
                { name: "Arm extended", detect: (lms) => elbowAngle(lms) > 150 },
                { name: "Curl up (< 90°)", detect: (lms) => elbowAngle(lms) < 100 },
                { name: "Hold curl", detect: (lms) => elbowAngle(lms) < 100, hold: 1.5 },
                { name: "Extend arm", detect: (lms) => elbowAngle(lms) > 150 },
            ],
        },
        forward_reach: {
            name: "Forward Reach", cat: "elbow_shoulder",
            metric_label: "TARGET DIST", skeleton: "arm",
            steps: [
                { name: "Arm at side", detect: (lms) => { const a = elbowAngle(lms); return a > 160; }},
                { name: "Reach forward", detect: (lms) => elbowAngle(lms) > 160 && reachDist(lms) > 0.15 },
                { name: "Hold reach", detect: (lms) => reachDist(lms) > 0.15, hold: 1.5 },
                { name: "Return", detect: (lms) => reachDist(lms) < 0.10 },
            ],
        },
        shoulder_raise: {
            name: "Shoulder Raise", cat: "elbow_shoulder",
            metric_label: "SHOULDER ANGLE", skeleton: "arm",
            steps: [
                { name: "Arm down", detect: (lms) => shoulderAngle(lms) < 30 },
                { name: "Raise sideways", detect: (lms) => shoulderAngle(lms) > 60 },
                { name: "Hold raise", detect: (lms) => shoulderAngle(lms) > 60, hold: 1.5 },
                { name: "Lower arm", detect: (lms) => shoulderAngle(lms) < 30 },
            ],
        },
        shoulder_reach: {
            name: "Shoulder Reach", cat: "elbow_shoulder",
            metric_label: "SHOULDER ANGLE", skeleton: "arm",
            steps: [
                { name: "Arm at side", detect: (lms) => shoulderAngle(lms) < 30 },
                { name: "Reach up", detect: (lms) => shoulderAngle(lms) > 70 },
                { name: "Hold reach", detect: (lms) => shoulderAngle(lms) > 70, hold: 1.5 },
                { name: "Lower arm", detect: (lms) => shoulderAngle(lms) < 30 },
            ],
        },
    };

    // =================================================================
    // HELPER: Extract hand landmark points as [x, y] arrays
    // =================================================================
    function getHandPts(lms) {
        if (!lms || !lms.hand) return [];
        const pts = [];
        for (let i = 0; i < 21; i++) {
            if (lms.hand[i]) pts.push([lms.hand[i].x, lms.hand[i].y]);
        }
        return pts;
    }

    // =================================================================
    // HELPER: Distance between two finger tips
    // =================================================================
    function fingerDist(lms, tipA, tipB) {
        if (!lms || !lms.hand || !lms.hand[tipA] || !lms.hand[tipB]) return 999;
        return MathCore.l2Distance(
            [lms.hand[tipA].x, lms.hand[tipA].y],
            [lms.hand[tipB].x, lms.hand[tipB].y]
        );
    }

    // =================================================================
    // HELPER: Elbow angle (shoulder → elbow → wrist)
    // =================================================================
    function elbowAngle(lms) {
        if (!lms || !lms.pose) return 180;
        const sh = lms.pose[11] || lms.pose[12]; // shoulder
        const el = lms.pose[13] || lms.pose[14]; // elbow
        const wr = lms.pose[15] || lms.pose[16]; // wrist
        if (!sh || !el || !wr) return 180;
        return MathCore.jointAngle(
            [sh.x, sh.y, sh.z || 0],
            [el.x, el.y, el.z || 0],
            [wr.x, wr.y, wr.z || 0]
        );
    }

    // =================================================================
    // HELPER: Wrist angle (elbow → wrist → middle finger MCP)
    // =================================================================
    function wristAngle(lms) {
        if (!lms || !lms.hand) return 180;
        const wr = lms.hand[0];
        const mcp = lms.hand[9];
        const tip = lms.hand[12];
        if (!wr || !mcp || !tip) return 180;
        return MathCore.jointAngle(
            [mcp.x, mcp.y, mcp.z || 0],
            [wr.x, wr.y, wr.z || 0],
            [tip.x, tip.y, tip.z || 0]
        );
    }

    // =================================================================
    // HELPER: Shoulder angle (elbow → shoulder → hip)
    // =================================================================
    function shoulderAngle(lms) {
        if (!lms || !lms.pose) return 0;
        const el = lms.pose[13] || lms.pose[14];
        const sh = lms.pose[11] || lms.pose[12];
        if (!el || !sh) return 0;
        // Use vertical as reference (shoulder straight down = 0°)
        const dx = el.x - sh.x;
        const dy = el.y - sh.y;
        const angle = Math.atan2(Math.abs(dx), Math.abs(dy)) * (180 / Math.PI);
        return angle;
    }

    // =================================================================
    // HELPER: Reach distance (how far wrist is from body center)
    // =================================================================
    function reachDist(lms) {
        if (!lms || !lms.pose) return 0;
        const wr = lms.pose[15] || lms.pose[16];
        const sh = lms.pose[11] || lms.pose[12];
        if (!wr || !sh) return 0;
        return Math.abs(wr.x - sh.x);
    }

    // =================================================================
    // ENGINE STATE
    // =================================================================
    let state = {
        exercise_keys: [],
        exercise_idx: 0,
        step_idx: 0,
        hold_start: 0,
        rep: 0,
        set: 1,
        reps_target: 10,
        sets_target: 3,
        rest_break: 30,
        wait_break: 60,
        phase: "ready", // ready, exercise, rest, break, done
        hint: "",
        hint_start: 0,
        feedback: "",
        feedback_start: 0,
        rep_metrics: [],
        wrist_buf: [],
        prev_wrist: null,
        prev_finger_tips: null,
        velocity_buf: [],
    };

    function reset(keys, options) {
        state.exercise_keys = keys || ["elbow_flexion"];
        state.exercise_idx = 0;
        state.step_idx = 0;
        state.hold_start = 0;
        state.rep = 0;
        state.set = 1;
        state.reps_target = options.reps || 10;
        state.sets_target = options.sets || 3;
        state.rest_break = options.rest || 30;
        state.wait_break = options.wait || 60;
        state.phase = "exercise";
        state.hint = "";
        state.hold_start = 0;
        state.feedback = "";
        state.rep_metrics = [];
        state.wrist_buf = [];
        state.prev_wrist = null;
        state.prev_finger_tips = null;
        state.velocity_buf = [];
    }

    // =================================================================
    // UPDATE — called every frame with landmarks
    // =================================================================
    function update(lms, fps) {
        if (state.phase === "done" || state.phase === "ready") return state;
        if (!lms || (!lms.hand && !lms.pose)) return state;

        const ex = EXERCISES[state.exercise_keys[state.exercise_idx]];
        if (!ex) { state.phase = "done"; return state; }

        const step = ex.steps[state.step_idx];
        if (!step) { state.phase = "done"; return state; }

        // Check if step is detected
        const detected = step.detect(lms);

        if (detected) {
            // Hold timer
            if (step.hold) {
                if (state.hold_start === 0) state.hold_start = Date.now();
                const held = (Date.now() - state.hold_start) / 1000;
                if (held < step.hold) {
                    state.hint = `Hold ${step.name} — ${Math.ceil(step.hold - held)}s`;
                    return state;
                }
            }
            // Step completed!
            state.hold_start = 0;
            state.step_idx++;
            state.hint = "";

            // All steps done = 1 rep
            if (state.step_idx >= ex.steps.length) {
                state.step_idx = 0;
                state.rep++;

                // Record rep metrics
                const metrics = computeMetrics(lms, fps);
                state.rep_metrics.push(metrics);

                // Feedback
                if (metrics.smoothness > 90) state.feedback = "Perfect!";
                else if (metrics.smoothness > 75) state.feedback = "Great job!";
                else if (metrics.smoothness > 50) state.feedback = "Good — keep moving smoothly";
                else state.feedback = "Try slower & smoother";
                state.feedback_start = Date.now();

                // Check if set complete
                if (state.rep >= state.reps_target) {
                    state.rep = 0;
                    state.set++;
                    if (state.set > state.sets_target) {
                        state.phase = "done";
                    } else {
                        state.phase = "rest";
                        state.hint = `Rest — next set in ${state.rest_break}s`;
                    }
                }
            }
        } else {
            // Not detected — hint after 2.5s stuck
            if (state.hint === "" && state.hold_start === 0) {
                state._stuck_start = Date.now();
            }
            if (state._stuck_start && (Date.now() - state._stuck_start) > 2500) {
                state.hint = `Try: ${step.name}`;
            }
            // Clear feedback after 3s
            if (state.feedback && (Date.now() - state.feedback_start) > 3000) {
                state.feedback = "";
            }
        }

        // Record wrist position for tremor buffer
        if (lms.hand && lms.hand[0]) {
            state.wrist_buf.push(lms.hand[0].x);
            state.wrist_buf = state.wrist_buf.slice(-48);
        }

        return state;
    }

    // =================================================================
    // Compute rep metrics (ROM, smoothness, speed, tremor)
    // =================================================================
    function computeMetrics(lms, fps) {
        const rom = elbowAngle(lms);
        const tremor = MathCore.fftTremor(state.wrist_buf, fps);

        // Speed from velocity buffer
        let speed = 0;
        if (lms.hand && lms.hand[0]) {
            if (state.prev_wrist) {
                speed = MathCore.wristSpeed(
                    [lms.hand[0].x, lms.hand[0].y],
                    [state.prev_wrist[0], state.prev_wrist[1]],
                    fps
                );
            }
            state.prev_wrist = [lms.hand[0].x, lms.hand[0].y];
        }

        state.velocity_buf.push(speed);
        state.velocity_buf = state.velocity_buf.slice(-30);
        const smoothness = MathCore.smoothnessScore(state.velocity_buf, fps);

        return {
            rep: state.rep_metrics.length + 1,
            rom: Math.round(rom),
            smoothness: smoothness,
            speed: Math.round(speed * 1000),
            tremor_hz: Math.round(tremor.hz * 10) / 10,
        };
    }

    // =================================================================
    // Get current state for UI display
    // =================================================================
    function getState() {
        const ex = EXERCISES[state.exercise_keys[state.exercise_idx]];
        if (!ex) return { ...state, phase: "done", exercise: "None" };

        // Clear old feedback
        if (state.feedback && (Date.now() - state.feedback_start) > 3000) {
            state.feedback = "";
        }

        return {
            ...state,
            exercise: ex.name,
            exercise_key: state.exercise_keys[state.exercise_idx],
            steps: ex.steps.map(s => s.name),
            step_name: ex.steps[state.step_idx] ? ex.steps[state.step_idx].name : "Done",
            metric_label: ex.metric_label,
            skeleton: ex.skeleton,
            variance: state.hand ? MathCore.handVariance(getHandPts(state.hand)).toFixed(3) : "0",
            elbow: elbowAngle(state),
            wrist: wristAngle(state),
            target_dist: reachDist(state).toFixed(2),
            rep_log: state.rep_metrics,
        };
    }

    // =================================================================
    // Advance to next exercise (called during rest/break)
    // =================================================================
    function nextExercise() {
        state.exercise_idx++;
        state.step_idx = 0;
        state.hold_start = 0;
        if (state.exercise_idx >= state.exercise_keys.length) {
            state.phase = "done";
        } else {
            state.phase = "exercise";
        }
    }

    // Timer update for rest/break phases
    function tick() {
        if (state.phase === "rest") {
            // Would need a timer — simplified: auto-advance after delay
            state.phase = "exercise";
            nextExercise();
        } else if (state.phase === "break") {
            state.phase = "exercise";
            nextExercise();
        }
        return state;
    }

    // =================================================================
    // Public API
    // =================================================================
    return {
        EXERCISES,
        reset,
        update,
        getState,
        tick,
        getElbowAngle: elbowAngle,
        getWristAngle: wristAngle,
        getShoulderAngle: shoulderAngle,
    };
})();
