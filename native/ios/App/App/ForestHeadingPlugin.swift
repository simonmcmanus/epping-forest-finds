import Capacitor
import CoreLocation

/// True-north heading for the map (spec/spec-native.md "Native heading plugin").
///
/// WebKit's own `webkitCompassHeading` is magnetic north only, unsmoothed, and stops firing on iOS
/// after the app is backgrounded without reliably resuming. Core Location's heading has none of
/// those problems, reports its own accuracy, and hands the figure-8 calibration to the OS.
/// The client feeds these readings into the same smoothing and heading-up pipeline as before:
/// this replaces the source, not the pipeline.
@objc(ForestHeadingPlugin)
public class ForestHeadingPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "ForestHeadingPlugin"
    public let jsName = "ForestHeading"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLocation", returnType: CAPPluginReturnPromise),
    ]

    private var manager: CLLocationManager?

    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["available": CLLocationManager.headingAvailable()])
    }

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard CLLocationManager.headingAvailable() else {
                call.resolve(["started": false])
                return
            }
            let manager = self.manager ?? CLLocationManager()
            manager.delegate = self
            // Whole degrees: finer than anything the map can show, and far fewer bridge messages.
            manager.headingFilter = 1
            // The app is portrait-locked, so the device's top edge is the reference.
            manager.headingOrientation = .portrait
            self.manager = manager
            manager.startUpdatingHeading()
            call.resolve(["started": true])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.manager?.stopUpdatingHeading()
            call.resolve()
        }
    }

    /// Core Location corrects for declination itself; accepted so both platforms share one API.
    @objc func setLocation(_ call: CAPPluginCall) {
        call.resolve()
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        // trueHeading is negative until Core Location has a position to correct for declination;
        // the client falls back to magneticHeading until then. A negative accuracy means invalid.
        notifyListeners("heading", data: [
            "trueHeading": newHeading.trueHeading,
            "magneticHeading": newHeading.magneticHeading,
            "accuracy": newHeading.headingAccuracy,
            "timestamp": newHeading.timestamp.timeIntervalSince1970 * 1000,
        ])
    }

    public func locationManagerShouldDisplayHeadingCalibration(_ manager: CLLocationManager) -> Bool {
        true
    }
}
