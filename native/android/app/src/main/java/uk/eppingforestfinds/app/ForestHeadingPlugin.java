package uk.eppingforestfinds.app;

import android.content.Context;
import android.hardware.GeomagneticField;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * True-north heading for the map (spec/spec-native.md "Native heading plugin").
 *
 * The fused rotation-vector sensor gives a far steadier azimuth than the WebView's
 * deviceorientation events, and correcting it with the magnetic declination at the walker's
 * position turns it into true north. The client feeds these readings into the same smoothing
 * and heading-up pipeline as before: this replaces the source, not the pipeline.
 */
@CapacitorPlugin(name = "ForestHeading")
public class ForestHeadingPlugin extends Plugin implements SensorEventListener {

    // At most one reading per 50ms, and only when it has moved: SENSOR_DELAY_GAME delivers ~50
    // a second, far more than the map can draw and each one is a message across the bridge.
    private static final long MIN_INTERVAL_MS = 50;
    private static final float MIN_CHANGE_DEG = 0.5f;

    private SensorManager sensorManager;
    private Sensor rotationSensor;
    private final float[] rotationMatrix = new float[9];
    private final float[] orientation = new float[3];
    private int sensorStatus = SensorManager.SENSOR_STATUS_UNRELIABLE;
    private Float declination = null;
    private long lastSentAt = 0;
    private float lastSentHeading = Float.NaN;

    @Override
    public void load() {
        sensorManager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        rotationSensor = sensorManager == null ? null : sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
    }

    @PluginMethod
    public void available(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", rotationSensor != null);
        call.resolve(result);
    }

    @PluginMethod
    public void start(PluginCall call) {
        JSObject result = new JSObject();
        if (rotationSensor == null) {
            result.put("started", false);
            call.resolve(result);
            return;
        }
        sensorManager.registerListener(this, rotationSensor, SensorManager.SENSOR_DELAY_GAME);
        result.put("started", true);
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (sensorManager != null) sensorManager.unregisterListener(this);
        call.resolve();
    }

    /** The walker's position, for the declination that turns magnetic north into true north. */
    @PluginMethod
    public void setLocation(PluginCall call) {
        Double latitude = call.getDouble("latitude");
        Double longitude = call.getDouble("longitude");
        if (latitude != null && longitude != null) {
            GeomagneticField field = new GeomagneticField(
                latitude.floatValue(), longitude.floatValue(), 0f, System.currentTimeMillis());
            declination = field.getDeclination();
        }
        call.resolve();
    }

    @Override
    protected void handleOnPause() {
        // Never hold the sensor while the app is in the background.
        if (sensorManager != null) sensorManager.unregisterListener(this);
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values);
        SensorManager.getOrientation(rotationMatrix, orientation);
        // The app is portrait-locked, so the device's top edge is the reference with no remap.
        float magnetic = normalise((float) Math.toDegrees(orientation[0]));
        float heading = declination == null ? magnetic : normalise(magnetic + declination);

        long now = System.currentTimeMillis();
        if (now - lastSentAt < MIN_INTERVAL_MS) return;
        if (!Float.isNaN(lastSentHeading) && Math.abs(shortestDelta(lastSentHeading, heading)) < MIN_CHANGE_DEG) return;
        lastSentAt = now;
        lastSentHeading = heading;

        JSObject data = new JSObject();
        data.put("trueHeading", declination == null ? -1 : heading);
        data.put("magneticHeading", magnetic);
        data.put("accuracy", accuracyDegrees(event));
        data.put("timestamp", now);
        notifyListeners("heading", data);
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
        sensorStatus = accuracy;
    }

    /** Degrees of uncertainty, or -1 when the sensor says it cannot be trusted. */
    private double accuracyDegrees(SensorEvent event) {
        // The rotation vector's own estimate, in radians, where the device reports one.
        if (event.values.length > 4 && event.values[4] > 0) return Math.toDegrees(event.values[4]);
        switch (sensorStatus) {
            case SensorManager.SENSOR_STATUS_ACCURACY_HIGH: return 10;
            case SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM: return 20;
            case SensorManager.SENSOR_STATUS_ACCURACY_LOW: return 35;
            default: return -1;
        }
    }

    private static float normalise(float degrees) {
        float value = degrees % 360f;
        return value < 0 ? value + 360f : value;
    }

    private static float shortestDelta(float from, float to) {
        float delta = (to - from) % 360f;
        if (delta > 180f) delta -= 360f;
        if (delta < -180f) delta += 360f;
        return delta;
    }
}
