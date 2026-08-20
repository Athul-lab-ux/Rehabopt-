/* ================================================================
   REHABOPT — math-core.js
   All 7 mathematical concepts in JavaScript (browser-side).
   
   C1: Vector Geometry & Inner Products  → joint angles
   C2: L2 Euclidean Distance             → target reach / collisions
   C3: Spatial Variance                  → fist vs finger-spread
   C4: Fast Fourier Transform            → tremor detection (4-12 Hz)
   S1: Central Finite Differences        → velocity / acceleration / jerk
   S2: Savitzky-Golay Filter             → camera noise removal
   S3: Quadratic Programming             → minimum-jerk trajectory (simplified)
   ================================================================ */

const MathCore = (() => {

    // =================================================================
    // C1: Vector Geometry — joint angle from 3D landmarks
    // θ = arccos( (a · b) / (‖a‖ · ‖b‖) )
    // =================================================================
    function jointAngle(a, b, c) {
        // a, b, c = [x, y, z] landmarks; angle at b
        const ba = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
        const bc = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
        const dot = ba[0]*bc[0] + ba[1]*bc[1] + ba[2]*bc[2];
        const magBA = Math.sqrt(ba[0]*ba[0] + ba[1]*ba[1] + ba[2]*ba[2]);
        const magBC = Math.sqrt(bc[0]*bc[0] + bc[1]*bc[1] + bc[2]*bc[2]);
        if (magBA === 0 || magBC === 0) return 0;
        let cosAngle = dot / (magBA * magBC);
        cosAngle = Math.max(-1, Math.min(1, cosAngle)); // clamp
        return Math.acos(cosAngle) * (180 / Math.PI); // degrees
    }

    // =================================================================
    // C2: L2 Euclidean Distance
    // d(p,q) = √(Σ(pᵢ − qᵢ)²)
    // =================================================================
    function l2Distance(p, q) {
        let sum = 0;
        for (let i = 0; i < Math.min(p.length, q.length); i++) {
            sum += (p[i] - q[i]) ** 2;
        }
        return Math.sqrt(sum);
    }

    // =================================================================
    // C3: Spatial Variance (standard deviation of hand landmarks)
    // σ = √( (1/N) · Σᵢ ‖xᵢ − x̄‖² )
    // Small σ = fist (fingers collapsed)  |  Large σ = spread
    // =================================================================
    function handVariance(landmarks) {
        // landmarks = array of [x, y] or [x, y, z] for 21 hand points
        if (!landmarks || landmarks.length < 21) return 0;
        const N = landmarks.length;
        // centroid
        const centroid = [0, 0];
        for (const lm of landmarks) {
            centroid[0] += lm[0];
            centroid[1] += lm[1];
        }
        centroid[0] /= N;
        centroid[1] /= N;
        // variance
        let sumSq = 0;
        for (const lm of landmarks) {
            sumSq += (lm[0] - centroid[0]) ** 2 + (lm[1] - centroid[1]) ** 2;
        }
        return Math.sqrt(sumSq / N);
    }

    // =================================================================
    // C4: Fast Fourier Transform (simple DFT for small windows)
    // X[k] = Σₙ₌₀ᴺ⁻¹ x[n] · e^(−j2πkn/N)
    // Returns dominant frequency in Hz and its power
    // =================================================================
    function fftTremor(signal, fps) {
        // signal = array of wrist-x positions over time
        // fps = frames per second (typically 30)
        if (!signal || signal.length < 8) return { hz: 0, power: 0 };
        const N = signal.length;
        // remove DC (mean)
        const mean = signal.reduce((a, b) => a + b, 0) / N;
        const centered = signal.map(v => v - mean);
        // DFT — find power in 4-12 Hz band (pathological tremor)
        let maxPower = 0;
        let maxHz = 0;
        const freqResolution = fps / N;
        for (let k = 1; k < N / 2; k++) {
            const freq = k * freqResolution;
            if (freq < 3 || freq > 15) continue; // only care about 4-12 Hz
            let real = 0, imag = 0;
            for (let n = 0; n < N; n++) {
                const angle = -2 * Math.PI * k * n / N;
                real += centered[n] * Math.cos(angle);
                imag += centered[n] * Math.sin(angle);
            }
            const power = (real * real + imag * imag) / N;
            if (power > maxPower) {
                maxPower = power;
                maxHz = freq;
            }
        }
        // threshold: only report if power is significant
        return { hz: maxPower > 0.5 ? maxHz : 0, power: maxPower };
    }

    // =================================================================
    // S1: Central Finite Differences
    // v(t) ≈ [x(t+h) − x(t−h)] / 2h
    // =================================================================
    function centralDiff(prev, next, dt) {
        // dt = 2 * frame_time (typically 2/30 seconds)
        if (!prev || !next || dt === 0) return 0;
        return (next - prev) / dt;
    }

    // Smoothness = inverse of mean absolute jerk (0-100 scale)
    function smoothnessScore(velocities, fps) {
        if (!velocities || velocities.length < 4) return 100;
        const dt = 1 / fps;
        let jerkSum = 0;
        for (let i = 2; i < velocities.length; i++) {
            const jerk = Math.abs(velocities[i] - velocities[i - 1]) / dt;
            jerkSum += jerk;
        }
        const avgJerk = jerkSum / (velocities.length - 2);
        // map to 0-100: lower jerk = higher score
        const score = Math.max(0, Math.min(100, 100 - avgJerk * 0.5));
        return Math.round(score);
    }

    // =================================================================
    // S2: Savitzky-Golay Filter (simplified — 5-point quadratic)
    // y*ₖ = (−3·yₖ₋₂ + 12·yₖ₋₁ + 17·yₖ + 12·yₖ₊₁ − 3·yₖ₊₂) / 35
    // =================================================================
    function savgolFilter(data, windowSize) {
        if (!data || data.length < 5) return data;
        const w = windowSize || 5;
        const half = Math.floor(w / 2);
        const result = [...data];
        // coefficients for 5-point quadratic SG filter
        const coeffs = [-3, 12, 17, 12, -3];
        const norm = 35;
        for (let i = half; i < data.length - half; i++) {
            let sum = 0;
            for (let j = -half; j <= half; j++) {
                sum += coeffs[j + half] * data[i + j];
            }
            result[i] = sum / norm;
        }
        return result;
    }

    // =================================================================
    // S3: Minimum-Jerk Trajectory (quintic polynomial, no CVXOPT needed)
    // s(τ) = 10τ³ − 15τ⁴ + 6τ⁵  where τ = t/T
    // This is the closed-form solution to the QP problem.
    // =================================================================
    function minJerkTrajectory(startPos, endPos, numPoints) {
        // startPos, endPos = [x, y] or [x, y, z]
        const n = numPoints || 50;
        const trajectory = [];
        for (let i = 0; i < n; i++) {
            const tau = i / (n - 1); // 0 to 1
            // quintic polynomial: smooth start and end with zero velocity
            const s = 10 * tau ** 3 - 15 * tau ** 4 + 6 * tau ** 5;
            const point = [];
            for (let d = 0; d < Math.min(startPos.length, endPos.length); d++) {
                point.push(startPos[d] + s * (endPos[d] - startPos[d]));
            }
            trajectory.push(point);
        }
        return trajectory;
    }

    // =================================================================
    // Helper: wrist speed (pixels per second)
    // =================================================================
    function wristSpeed(currentWrist, prevWrist, fps) {
        if (!currentWrist || !prevWrist || !fps) return 0;
        const dist = l2Distance(currentWrist, prevWrist);
        return dist * fps; // px/s
    }

    // =================================================================
    // Helper: finger speed (average of all fingertips)
    // =================================================================
    function fingerSpeed(currentTips, prevTips, fps) {
        if (!currentTips || !prevTips || currentTips.length < 5) return 0;
        let totalSpeed = 0;
        for (let i = 0; i < 5; i++) {
            totalSpeed += wristSpeed(currentTips[i], prevTips[i], fps);
        }
        return totalSpeed / 5;
    }

    // =================================================================
    // Public API
    // =================================================================
    return {
        jointAngle,        // C1
        l2Distance,        // C2
        handVariance,      // C3
        fftTremor,         // C4
        centralDiff,       // S1
        smoothnessScore,   // S1 (aggregated)
        savgolFilter,      // S2
        minJerkTrajectory, // S3
        wristSpeed,        // helper
        fingerSpeed,       // helper
    };
})();
