// Stream watching and management
class StreamingManager {
  constructor() {
    this.currentStream = null;
    this.watchStartTime = null;
    this.progressInterval = null;
    this.isFarming = false;
  }

  async startFarming(categories) {
    this.isFarming = true;
    const settings = await Storage.getSettings();
    const blacklist = await Storage.getBlacklist();

    for (const category of categories) {
      if (!this.isFarming) break;

      const dropsData = await dropsManager.getDropsForCategory(category.id);
      
      if (!dropsData || !dropsData.drops || dropsData.drops.length === 0) {
        continue;
      }

      // Select streamer
      const streamer = await dropsManager.selectStreamer(
        dropsData,
        settings.preferredLanguage,
        blacklist
      );

      if (!streamer) {
        continue;
      }

      // Start watching stream
      await this.watchStream(streamer.name, dropsData.drops);

      // Wait until all drops for this category are completed
      await this.waitForCategoryCompletion(dropsData.drops);
    }

    // All categories done
    if (this.isFarming) {
      this.onFarmingComplete();
    }
  }

  async watchStream(streamerName, drops) {
    const streamUrl = `https://www.twitch.tv/${streamerName}`;
    
    this.currentStream = {
      streamer: streamerName,
      url: streamUrl,
      drops: drops
    };

    this.watchStartTime = Date.now();

    // Open stream in background
    window.electronAPI.openStream(streamUrl);

    // Start progress tracking
    this.startProgressTracking(drops);

    // Update UI
    this.updateStreamUI();
  }

  startProgressTracking(drops) {
    const settings = Storage.getSettings();
    const checkIntervalMs = 60000; // 1 minute by default

    if (this.progressInterval) {
      clearInterval(this.progressInterval);
    }

    this.progressInterval = setInterval(async () => {
      const watchTime = (Date.now() - this.watchStartTime) / 60000; // minutes

      for (const drop of drops) {
        const progress = Math.min(100, (watchTime / drop.duration) * 100);
        await dropsManager.updateDropProgress(drop.id, progress);
        this.updateDropProgressUI(drop.id, progress);
      }

      // Update statistics
      const stats = await Storage.getStatistics();
      stats.totalWatchTime = (stats.totalWatchTime || 0) + 1; // +1 minute
      await Storage.updateStatistics(stats);

    }, checkIntervalMs);
  }

  async waitForCategoryCompletion(drops) {
    return new Promise((resolve) => {
      const checkCompletion = setInterval(() => {
        const allCompleted = drops.every(drop => {
          const progress = dropsManager.getActiveDropProgress(drop.id);
          return progress && progress.completed;
        });

        if (allCompleted || !this.isFarming) {
          clearInterval(checkCompletion);
          resolve();
        }
      }, 5000); // Check every 5 seconds
    });
  }

  async onFarmingComplete() {
    this.stopFarming();

    // Show notification
    window.electronAPI.showNotification(
      i18n.t('farming.completed'),
      'All drops have been collected!'
    );

    // Check for auto-shutdown
    const settings = await Storage.getSettings();
    if (settings.enableShutdown) {
      this.showShutdownWarning(settings.shutdownAction);
    }
  }

  showShutdownWarning(action) {
    const modal = document.createElement('div');
    modal.className = 'shutdown-modal';
    modal.innerHTML = `
      <div class="modal-overlay"></div>
      <div class="modal-content scale-in">
        <h3>⚠️ Auto-Shutdown Warning</h3>
        <p>System will ${action} in <span id="countdown">30</span> seconds</p>
        <div class="modal-actions">
          <button class="btn btn-primary" id="cancel-shutdown">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    let countdown = 30;
    const countdownEl = modal.querySelector('#countdown');
    
    const interval = setInterval(() => {
      countdown--;
      countdownEl.textContent = countdown;
      
      if (countdown <= 0) {
        clearInterval(interval);
        window.electronAPI.shutdownComputer(action);
      }
    }, 1000);

    modal.querySelector('#cancel-shutdown').addEventListener('click', () => {
      clearInterval(interval);
      document.body.removeChild(modal);
    });
  }

  stopFarming() {
    this.isFarming = false;
    
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
    }

    window.electronAPI.closeStream();
    dropsManager.stopTracking();
    
    this.currentStream = null;
    this.watchStartTime = null;
  }

  updateStreamUI() {
    const streamInfo = document.getElementById('current-stream-info');
    if (streamInfo && this.currentStream) {
      streamInfo.innerHTML = `
        <div class="stream-card">
          <div class="stream-header">
            <div class="status-indicator status-farming"></div>
            <span class="stream-name">${this.currentStream.streamer}</span>
          </div>
          <div class="stream-preview">
            <img src="https://static-cdn.jtvnw.net/previews-ttv/live_user_${this.currentStream.streamer.toLowerCase()}-440x248.jpg" 
                 alt="Stream preview" 
                 onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22440%22 height=%22248%22%3E%3Crect fill=%22%23222%22 width=%22440%22 height=%22248%22/%3E%3C/svg%3E'">
          </div>
        </div>
      `;
    }
  }

  updateDropProgressUI(dropId, progress) {
    const progressBar = document.querySelector(`[data-drop-id="${dropId}"] .progress-fill`);
    if (progressBar) {
      progressBar.style.width = `${progress}%`;
      
      if (progress >= 100) {
        progressBar.parentElement.parentElement.classList.add('drop-completed');
      }
    }
  }

  getCurrentStream() {
    return this.currentStream;
  }

  isFarmingActive() {
    return this.isFarming;
  }
}

// Create global instance
if (!window.streamingManager) {
  window.streamingManager = new StreamingManager();
}
