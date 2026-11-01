// Rotates drifting stars around their axis (Rodrigues' formula), injected
// after <begin_vertex> in PointsMaterial.
float driftAngle = aDrift.w * uTime;
float driftCos = cos(driftAngle);
float driftSin = sin(driftAngle);
transformed = transformed * driftCos
            + cross(aDrift.xyz, transformed) * driftSin
            + aDrift.xyz * dot(aDrift.xyz, transformed) * (1.0 - driftCos);
