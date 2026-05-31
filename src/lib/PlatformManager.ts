/**
 * PlatformManager class
 * We have a desktop application built with Tauri. This will help us conditionally show/hide things on the desktop app
   since there is a good chance the desktop app will not have a internet connection
 **/ 
export class PlatformManager {

  private isTauri: boolean;
  private platform: 'desktop' | 'web';

  constructor() {
    this.isTauri = '__TAURI_INTERNALS__' in window;
    this.platform = this.isTauri ? 'desktop' : 'web';
    console.log(this.platform ? 'Plastform: Desktop' : 'Platform: Web');
  }


  public init() {
    document.documentElement.dataset.platform = this.platform;

    if (this.platform === 'desktop') {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/desktop.css';
      document.head.appendChild(link);
    }

    return this;
  }
}
