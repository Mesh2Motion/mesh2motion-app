// test going offline and online through the console like this
// window.dispatchEvent(new Event('offline'))  // shows "You are offline"
// window.dispatchEvent(new Event('online'))   // shows "You are back online"

// The developer tools also have an offline mode (by the "throttling option" in network tab)
// for testing


/**
 * Manages network status and displays a toast notification when the status changes.
 */
export class NetworkStatusManager {

  private toast_timeout: number | null = null

  constructor() {
    this.update(navigator.onLine, false)
    window.addEventListener('online', () => this.update(true, true))
    window.addEventListener('offline', () => this.update(false, true))
  }

  private update(online: boolean, show_toast: boolean): void {

    // update the data attribute we use to apply offline styles in CSS
    if (online) {
      delete document.documentElement.dataset.networkStatus
    } else {
      document.documentElement.dataset.networkStatus = 'offline'
    }

    // Show a toast notification if requested
    if (show_toast) {
      this.show_toast(online ? 'You are back online' : 'You are offline')
    }
  }

  private show_toast(message: string): void {

    // Clear any existing toast timeout to prevent multiple toasts from stacking
    if (this.toast_timeout !== null) {
      clearTimeout(this.toast_timeout)
      this.toast_timeout = null
    }

    let toast = document.getElementById('network-status-toast')

    // If the toast element doesn't exist, create it and append to the body
    if (toast === null) {
      toast = document.createElement('div')
      toast.id = 'network-status-toast'
      document.body.appendChild(toast)
    }

    // Update the toast message and show it
    toast.textContent = message
    toast.classList.remove('network-toast-hide')
    toast.classList.add('network-toast-show')

    // Automatically hide the toast after 5 seconds
    this.toast_timeout = setTimeout(() => {
      toast!.classList.remove('network-toast-show')
      toast!.classList.add('network-toast-hide')
      this.toast_timeout = null
    }, 5000)
  }
}
