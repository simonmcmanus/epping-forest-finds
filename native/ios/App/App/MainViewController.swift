import Capacitor

/// The app's root view: Capacitor's bridge plus the plugins that live in this app target rather
/// than in an npm package.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ForestHeadingPlugin())
    }
}
