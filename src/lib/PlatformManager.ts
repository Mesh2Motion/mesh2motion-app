import { StringStreamHandler } from "three/examples/jsm/libs/fflate.module.js";

/**
 * PlatformManager class
 * We have a desktop application built with Tauri. This will help us conditionally show/hide things on the desktop app
   since there is a good chance the desktop app will not have a internet connection
 **/ 

export enum Platform {
    Web = "Web",
    Desktop = "Desktop"
}

export class PlatformManager {

  private isTauri: boolean;
  private platform: Platform;

  constructor() {
    this.isTauri = '__TAURI_INTERNALS__' in window;
    this.platform = this.isTauri ? Platform.Desktop : Platform.Web;
    console.log(`Platform: ${this.platform}`);
  }


  public init() {
    document.documentElement.dataset.platform = this.platform;

    if (this.platform === Platform.Desktop) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/desktop.css';
      document.head.appendChild(link);
    }

    return this;
  }
}
