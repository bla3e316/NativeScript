﻿import {
    iOSApplication as IOSApplicationDefinition,
    LaunchEventData,
    ApplicationEventData,
    OrientationChangedEventData,
    LoadAppCSSEventData
} from ".";

import {
    notify, launchEvent, resumeEvent, suspendEvent, exitEvent, lowMemoryEvent,
    orientationChangedEvent, setApplication, livesync, displayedEvent, getCssFileName
} from "./application-common";

// First reexport so that app module is initialized.
export * from "./application-common";

import { Frame, View, NavigationEntry } from "../ui/frame";
import { ios } from "../ui/utils";
import * as utils from "../utils/utils";

class Responder extends UIResponder {
    //
}

let displayedOnce = false;

class Window extends UIWindow {
    public content;

    initWithFrame(frame: CGRect): this {
        const window = <this>super.initWithFrame(frame);
        if (window) {
            window.autoresizingMask = UIViewAutoresizing.None;
        }
        return window;
    }

    public layoutSubviews(): void {
        if (utils.ios.MajorVersion < 9) {
            ios._layoutRootView(this.content, utils.ios.getter(UIScreen, UIScreen.mainScreen).bounds);
        } else {
            ios._layoutRootView(this.content, this.frame);
        }
    }
}

class NotificationObserver extends NSObject {
    private _onReceiveCallback: (notification: NSNotification) => void;

    public static initWithCallback(onReceiveCallback: (notification: NSNotification) => void): NotificationObserver {
        const observer = <NotificationObserver>super.new();
        observer._onReceiveCallback = onReceiveCallback;
        return observer;
    }

    public onReceive(notification: NSNotification): void {
        this._onReceiveCallback(notification);
    }

    public static ObjCExposedMethods = {
        "onReceive": { returns: interop.types.void, params: [NSNotification] }
    };
}

class IOSApplication implements IOSApplicationDefinition {
    public rootController: any;

    private _delegate: typeof UIApplicationDelegate;
    private _currentOrientation = utils.ios.getter(UIDevice, UIDevice.currentDevice).orientation;
    private _window: Window;
    private _observers: Array<NotificationObserver>;

    constructor() {
        this._observers = new Array<NotificationObserver>();
        this.addNotificationObserver(UIApplicationDidFinishLaunchingNotification, this.didFinishLaunchingWithOptions.bind(this));
        this.addNotificationObserver(UIApplicationDidBecomeActiveNotification, this.didBecomeActive.bind(this));
        this.addNotificationObserver(UIApplicationDidEnterBackgroundNotification, this.didEnterBackground.bind(this));
        this.addNotificationObserver(UIApplicationWillTerminateNotification, this.willTerminate.bind(this));
        this.addNotificationObserver(UIApplicationDidReceiveMemoryWarningNotification, this.didReceiveMemoryWarning.bind(this));
        this.addNotificationObserver(UIDeviceOrientationDidChangeNotification, this.orientationDidChange.bind(this));
    }

    get nativeApp(): UIApplication {
        return utils.ios.getter(UIApplication, UIApplication.sharedApplication);
    }

    get window(): Window {
        return this._window;
    }

    get delegate(): typeof UIApplicationDelegate {
        return this._delegate;
    }
    set delegate(value: typeof UIApplicationDelegate) {
        if (this._delegate !== value) {
            this._delegate = value;
        }
    }

    public addNotificationObserver(notificationName: string, onReceiveCallback: (notification: NSNotification) => void): NotificationObserver {
        const observer = NotificationObserver.initWithCallback(onReceiveCallback);
        utils.ios.getter(NSNotificationCenter, NSNotificationCenter.defaultCenter).addObserverSelectorNameObject(observer, "onReceive", notificationName, null);
        this._observers.push(observer);
        return observer;
    }

    public removeNotificationObserver(observer: any, notificationName: string) {
        var index = this._observers.indexOf(observer);
        if (index >= 0) {
            this._observers.splice(index, 1);
            utils.ios.getter(NSNotificationCenter, NSNotificationCenter.defaultCenter).removeObserverNameObject(observer, notificationName, null);
        }
    }

    private didFinishLaunchingWithOptions(notification: NSNotification) {
        this._window = <Window>Window.alloc().initWithFrame(utils.ios.getter(UIScreen, UIScreen.mainScreen).bounds);
        this._window.backgroundColor = utils.ios.getter(UIColor, UIColor.whiteColor);

        const args: LaunchEventData = {
            eventName: launchEvent,
            object: this,
            ios: notification.userInfo && notification.userInfo.objectForKey("UIApplicationLaunchOptionsLocalNotificationKey") || null
        };

        notify(args);
        notify(<LoadAppCSSEventData>{ eventName: "loadAppCss", object: <any>this, cssFile: getCssFileName() });

        let rootView = createRootView(args.root);
        this._window.content = rootView;

        if (rootView instanceof Frame) {
            this.rootController = this._window.rootViewController = rootView.ios.controller;
        }
        else if (rootView.ios instanceof UIViewController) {
            this.rootController = this._window.rootViewController = rootView.ios;
        }
        else if (rootView.ios instanceof UIView) {
            let newController = UIViewController.new();
            newController.view.addSubview(rootView.ios);
            this.rootController = newController;
        }
        else {
            throw new Error("Root should be either UIViewController or UIView");
        }

        this._window.makeKeyAndVisible();
    }

    private didBecomeActive(notification: NSNotification) {
        let ios = utils.ios.getter(UIApplication, UIApplication.sharedApplication);
        let object = this;
        notify(<ApplicationEventData>{ eventName: resumeEvent, object, ios });
        if (!displayedOnce) {
            notify(<ApplicationEventData>{ eventName: displayedEvent, object, ios });
            displayedOnce = true;
        }
    }

    private didEnterBackground(notification: NSNotification) {
        notify(<ApplicationEventData>{ eventName: suspendEvent, object: this, ios: utils.ios.getter(UIApplication, UIApplication.sharedApplication) });
    }

    private willTerminate(notification: NSNotification) {
        notify(<ApplicationEventData>{ eventName: exitEvent, object: this, ios: utils.ios.getter(UIApplication, UIApplication.sharedApplication) });
    }

    private didReceiveMemoryWarning(notification: NSNotification) {
        notify(<ApplicationEventData>{ eventName: lowMemoryEvent, object: this, ios: utils.ios.getter(UIApplication, UIApplication.sharedApplication) });
    }

    private orientationDidChange(notification: NSNotification) {
        const orientation = utils.ios.getter(UIDevice, UIDevice.currentDevice).orientation;

        if (this._currentOrientation !== orientation) {
            this._currentOrientation = orientation;

            let newValue: "portrait" | "landscape" | "unknown";
            switch (orientation) {
                case UIDeviceOrientation.LandscapeRight:
                case UIDeviceOrientation.LandscapeLeft:
                    newValue = "landscape";
                    break;
                case UIDeviceOrientation.Portrait:
                case UIDeviceOrientation.PortraitUpsideDown:
                    newValue = "portrait";
                    break;
                default:
                    newValue = "unknown";
                    break;
            }

            notify(<OrientationChangedEventData>{
                eventName: orientationChangedEvent,
                ios: this,
                newValue: newValue,
                object: this
            });
        }
    }
}

const iosApp = new IOSApplication();
exports.ios = iosApp;
setApplication(iosApp);

let mainEntry: NavigationEntry;
function createRootView(v?: View) {
    let rootView = v;
    let frame: Frame;
    let main: string | NavigationEntry;
    if (!rootView) {
        // try to navigate to the mainEntry (if specified)
        main = mainEntry;
        if (main) {
            frame = new Frame();
            frame.navigate(main);
        } else {
            // TODO: Throw an exception?
            throw new Error("A Frame must be used to navigate to a Page.");
        }

        rootView = frame;
    }

    rootView._setupAsRootView({});
    return rootView;
}

export function getMainEntry() {
    return mainEntry;
}

let started: boolean = false;
export function start(entry?: string | NavigationEntry) {
    mainEntry = typeof entry === "string" ? { moduleName: entry } : entry;
    started = true;

    if (!iosApp.nativeApp) {
        // Normal NativeScript app will need UIApplicationMain. 
        UIApplicationMain(0, null, null, iosApp && iosApp.delegate ? NSStringFromClass(<any>iosApp.delegate) : NSStringFromClass(Responder));
    } else {
        let rootView = createRootView();
        if (rootView) {
            // Attach to the existing iOS app
            var window = iosApp.nativeApp.keyWindow || (iosApp.nativeApp.windows.count > 0 && iosApp.nativeApp.windows[0]);
            if (window) {
                var rootController = window.rootViewController;
                if (rootController) {
                    rootController.presentViewControllerAnimatedCompletion(rootView.ios.controller, true, null);
                    ios._layoutRootView(rootView, utils.ios.getter(UIScreen, UIScreen.mainScreen).bounds);
                }
            }
        }
    }
}

export function getNativeApplication(): UIApplication {
    return iosApp.nativeApp;
}

global.__onLiveSync = function () {
    if (!started) {
        return;
    }

    livesync();
}