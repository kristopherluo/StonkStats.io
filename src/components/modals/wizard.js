/**
 * Trade Wizard - Guided trade logging with thesis prompts
 */

import { state } from '../../core/state.js';
import { showToast } from '../ui/ui.js';
import { formatCurrency, formatNumber, formatPercent, formatDate, createTimestampFromDateInput } from '../../core/utils.js';
import { priceTracker } from '../../core/priceTracker.js';

class TradeWizard {
  constructor() {
    this.elements = {};
    this.currentStep = 1;
    this.totalSteps = 3;
    this.skippedSteps = [];

    // Thesis data collected during wizard
    this.thesis = {
      setupType: null,
      theme: null,
      conviction: null
    };

    this.notes = '';
  }

  init() {
    this.cacheElements();
    this.bindEvents();
    this.initNotesEditor();
  }

  initNotesEditor() {
    // Auto-convert "- " to bullet points (same as journal notes)
    if (!this.elements.notesInput) return;

    this.elements.notesInput.addEventListener('input', (e) => {
      const selection = window.getSelection();
      if (!selection.rangeCount) return;

      const range = selection.getRangeAt(0);
      const textNode = range.startContainer;

      // Only work with text nodes
      if (textNode.nodeType !== Node.TEXT_NODE) return;

      const textContent = textNode.textContent;
      const cursorPos = range.startOffset;

      // Check if the text just before cursor is "- " (support both regular space and &nbsp;)
      if (cursorPos >= 2) {
        const substringToCheck = textContent.substring(cursorPos - 2, cursorPos);
        const isDash = substringToCheck[0] === '-';
        const isSpace = substringToCheck[1] === ' ' || substringToCheck[1] === '\u00A0'; // Regular space or &nbsp;

        if (isDash && isSpace) {
        const beforeDash = textContent.substring(0, cursorPos - 2);
        const afterDash = textContent.substring(cursorPos);
        const combinedText = beforeDash + afterDash;

        // Create a proper list structure
        const ul = document.createElement('ul');
        const li = document.createElement('li');

        if (combinedText) {
          li.textContent = combinedText;
        } else {
          li.innerHTML = '<br>';
        }

        ul.appendChild(li);

        // Replace content with list
        const parent = textNode.parentNode;
        if (parent === this.elements.notesInput) {
          this.elements.notesInput.replaceChild(ul, textNode);
        } else {
          parent.parentNode.replaceChild(ul, parent);
        }

        // Set cursor in the li
        const newRange = document.createRange();
        const newSelection = window.getSelection();

        if (li.firstChild) {
          newRange.setStart(li.firstChild, combinedText.length);
        } else {
          newRange.setStart(li, 0);
        }

        newRange.collapse(true);
        newSelection.removeAllRanges();
        newSelection.addRange(newRange);
        }
      }
    });
  }

  cacheElements() {
    this.elements = {
      // Modal
      modal: document.getElementById('wizardModal'),
      overlay: document.getElementById('wizardModalOverlay'),
      closeBtn: document.getElementById('closeWizardBtn'),

      // Progress
      progressSteps: document.querySelectorAll('.wizard-progress__step'),
      connectors: document.querySelectorAll('.wizard-progress__connector'),

      // Steps
      steps: document.querySelectorAll('.wizard-step'),

      // Step 1 - Trade Details
      wizardTickerInput: document.getElementById('wizardTickerInput'),
      wizardTickerHint: document.getElementById('wizardTickerHint'),
      wizardEntry: document.getElementById('wizardEntry'),
      wizardStop: document.getElementById('wizardStop'),
      wizardShares: document.getElementById('wizardShares'),
      wizardPosition: document.getElementById('wizardPosition'),
      wizardRisk: document.getElementById('wizardRisk'),
      wizardTarget: document.getElementById('wizardTarget'),
      skipAllBtn: document.getElementById('wizardSkipAll'),
      next1Btn: document.getElementById('wizardNext1'),

      // Step 2 - Thesis
      setupBtns: document.querySelectorAll('[data-setup]'),
      themeInput: document.getElementById('wizardTheme'),
      convictionStars: document.querySelectorAll('.wizard-star'),
      notesInput: document.getElementById('wizardNotes'),
      back2Btn: document.getElementById('wizardBack2'),
      skip2Btn: document.getElementById('wizardSkip2'),
      next2Btn: document.getElementById('wizardNext2'),

      // Step 3 - Confirmation
      confirmTicker: document.getElementById('wizardConfirmTicker'),
      confirmPosition: document.getElementById('wizardConfirmPosition'),
      confirmRisk: document.getElementById('wizardConfirmRisk'),
      confirmDate: document.getElementById('wizardConfirmDate'),
      confirmSetupRow: document.getElementById('wizardConfirmSetupRow'),
      confirmSetup: document.getElementById('wizardConfirmSetup'),
      confirmThemeRow: document.getElementById('wizardConfirmThemeRow'),
      confirmTheme: document.getElementById('wizardConfirmTheme'),
      streakDisplay: document.getElementById('wizardStreakDisplay'),
      streakText: document.getElementById('wizardStreakText'),
      back3Btn: document.getElementById('wizardBack3'),
      confirmBtn: document.getElementById('wizardConfirmBtn'),

      // Confetti
      confettiCanvas: document.getElementById('confettiCanvas')
    };
  }

  bindEvents() {
    // Close modal
    this.elements.closeBtn?.addEventListener('click', () => this.close());
    this.elements.overlay?.addEventListener('click', () => this.close());

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (!this.isOpen()) return;
      if (e.key === 'Escape') this.close();
      if (e.key === 'Enter' && !e.shiftKey) {
        // Don't trigger next step if user is typing in the notes editor
        const isInNotesEditor = e.target.closest('.wizard-notes-editable');
        if (isInNotesEditor) return;

        e.preventDefault();
        this.nextStep();
      }
    });

    // Step 1 buttons - require ticker before proceeding
    this.elements.skipAllBtn?.addEventListener('click', () => {
      if (this.validateTicker()) this.skipAll();
    });
    this.elements.next1Btn?.addEventListener('click', () => {
      if (this.validateTicker()) this.goToStep(2);
    });

    // Step 2 buttons
    this.elements.back2Btn?.addEventListener('click', () => this.goToStep(1));
    this.elements.skip2Btn?.addEventListener('click', () => this.skipStep(2));
    this.elements.next2Btn?.addEventListener('click', () => this.goToStep(3));

    // Step 3 buttons
    this.elements.back3Btn?.addEventListener('click', () => this.goToStep(2));
    this.elements.confirmBtn?.addEventListener('click', () => this.confirmTrade());

    // Setup type buttons
    this.elements.setupBtns?.forEach(btn => {
      btn.addEventListener('click', () => {
        this.elements.setupBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.thesis.setupType = btn.dataset.setup;
      });
    });

    // Conviction stars
    this.elements.convictionStars?.forEach(star => {
      star.addEventListener('click', () => {
        const level = parseInt(star.dataset.conviction);
        this.thesis.conviction = level;
        this.elements.convictionStars.forEach((s, i) => {
          s.classList.toggle('active', i < level);
        });
      });
    });

    // Ticker input - update state and UI as user types
    this.elements.wizardTickerInput?.addEventListener('input', () => {
      const ticker = this.elements.wizardTickerInput.value.toUpperCase();
      this.elements.wizardTickerInput.value = ticker; // Force uppercase
      this.updateTickerHint();
      // Update state so it persists
      state.updateTrade({ ticker });
    });
  }

  isOpen() {
    return this.elements.modal?.classList.contains('open');
  }

  open() {
    if (!this.elements.modal) return;

    // Reset state
    this.currentStep = 1;
    this.skippedSteps = [];
    this.thesis = {
      setupType: null,
      theme: null,
      conviction: null
    };
    this.notes = '';

    // Reset UI
    this.resetForm();

    // Pre-fill from calculator
    this.prefillFromCalculator();

    // Show modal
    this.elements.modal.classList.add('open');
    this.elements.overlay?.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Show step 1
    this.showStep(1);
  }

  close() {
    this.elements.modal?.classList.remove('open');
    this.elements.overlay?.classList.remove('open');
    document.body.style.overflow = '';
  }

  resetForm() {
    // Reset buttons
    this.elements.setupBtns?.forEach(b => b.classList.remove('active'));
    this.elements.convictionStars?.forEach(s => s.classList.remove('active'));

    // Reset inputs
    if (this.elements.themeInput) this.elements.themeInput.value = '';

    // Reset notes editor
    if (this.elements.notesInput) {
      this.elements.notesInput.innerHTML = '';
    }
    this.notes = '';

    // Reset progress
    this.elements.progressSteps?.forEach(step => {
      step.classList.remove('active', 'completed');
    });
    this.elements.progressSteps?.[0]?.classList.add('active');
  }

  updateTickerHint() {
    const hasValue = this.elements.wizardTickerInput?.value.trim().length > 0;
    if (this.elements.wizardTickerHint) {
      this.elements.wizardTickerHint.style.display = hasValue ? 'none' : 'block';
    }
    if (this.elements.wizardTickerInput) {
      this.elements.wizardTickerInput.classList.toggle('wizard-ticker-input--empty', !hasValue);
    }
  }

  validateTicker() {
    const ticker = this.elements.wizardTickerInput?.value.trim();
    if (!ticker) {
      // Shake the input to indicate error
      this.elements.wizardTickerInput?.classList.add('wizard-ticker-input--shake');
      this.elements.wizardTickerInput?.focus();
      setTimeout(() => {
        this.elements.wizardTickerInput?.classList.remove('wizard-ticker-input--shake');
      }, 500);
      return false;
    }
    return true;
  }

  prefillFromCalculator() {
    const trade = state.trade;
    const results = state.results;
    const account = state.account;

    // Step 1 ticker input
    if (this.elements.wizardTickerInput) {
      this.elements.wizardTickerInput.value = trade.ticker || '';
      this.updateTickerHint();
    }
    if (this.elements.wizardEntry) {
      this.elements.wizardEntry.textContent = formatCurrency(trade.entry || 0);
    }
    if (this.elements.wizardStop) {
      this.elements.wizardStop.textContent = formatCurrency(trade.stop || 0);
    }
    if (this.elements.wizardShares) {
      this.elements.wizardShares.textContent = formatNumber(results.shares || 0);
    }
    if (this.elements.wizardPosition) {
      this.elements.wizardPosition.textContent = formatCurrency(results.positionSize || 0);
    }
    if (this.elements.wizardRisk) {
      this.elements.wizardRisk.textContent = formatCurrency(results.riskDollars || 0);
    }
    if (this.elements.wizardTarget) {
      this.elements.wizardTarget.textContent = trade.target ? formatCurrency(trade.target) : '—';
    }

    // Step 2 notes - pre-fill from Quick Note on dashboard
    const quickNoteEl = document.getElementById('tradeNotes');
    if (this.elements.notesInput && quickNoteEl) {
      const quickNoteContent = quickNoteEl.innerHTML.trim();
      if (quickNoteContent) {
        this.elements.notesInput.innerHTML = quickNoteContent;
      }
    }

    // Step 3 confirmation - will be updated in updateConfirmation()
    if (this.elements.confirmTicker) {
      this.elements.confirmTicker.textContent = trade.ticker || 'No Ticker';
    }
    if (this.elements.confirmPosition) {
      this.elements.confirmPosition.textContent =
        `${formatNumber(results.shares || 0)} shares @ ${formatCurrency(trade.entry || 0)}`;
    }
    if (this.elements.confirmRisk) {
      this.elements.confirmRisk.textContent =
        `${formatCurrency(results.riskDollars || 0)} (${formatPercent(account.riskPercent || 0)})`;
    }
    if (this.elements.confirmDate) {
      // Get trade date from calculator or use today
      const tradeDateInput = document.getElementById('tradeDate');
      const tradeDate = tradeDateInput?.value || new Date().toISOString().split('T')[0];
      const timestamp = createTimestampFromDateInput(tradeDate);
      const formattedDate = formatDate(timestamp, { year: 'numeric' });
      this.elements.confirmDate.textContent = formattedDate;
    }
  }

  showStep(step) {
    this.currentStep = step;

    // Update steps visibility
    this.elements.steps?.forEach((stepEl, i) => {
      const stepNum = i + 1;
      stepEl.classList.remove('active', 'exit-left');
      if (stepNum === step) {
        stepEl.classList.add('active');
      }
    });

    // Update progress indicators
    this.elements.progressSteps?.forEach((progressStep, i) => {
      const stepNum = i + 1;
      progressStep.classList.remove('active', 'completed');
      if (stepNum < step) {
        progressStep.classList.add('completed');
      } else if (stepNum === step) {
        progressStep.classList.add('active');
      }
    });

    // Update confirmation on step 3
    if (step === 3) {
      this.updateConfirmation();
    }
  }

  goToStep(step) {
    if (step < 1 || step > this.totalSteps) return;

    // Collect data before leaving current step
    this.collectStepData();

    this.showStep(step);
  }

  nextStep() {
    if (this.currentStep < this.totalSteps) {
      this.goToStep(this.currentStep + 1);
    } else {
      this.confirmTrade();
    }
  }

  skipStep(step) {
    if (!this.skippedSteps.includes(step)) {
      this.skippedSteps.push(step);
    }
    this.goToStep(step + 1);
  }

  async skipAll() {
    // Direct save without wizard
    await this.logTrade(false);
    this.close();
  }

  collectStepData() {
    // Step 2 - Thesis
    if (this.currentStep === 2) {
      this.thesis.theme = this.elements.themeInput?.value.trim() || null;
      // Get notes from contenteditable div (store as HTML for formatting)
      if (this.elements.notesInput) {
        this.notes = this.elements.notesInput.innerHTML.trim() || '';
      }
    }
  }

  updateConfirmation() {
    // Update ticker from input
    const ticker = this.elements.wizardTickerInput?.value.trim() || '';
    if (this.elements.confirmTicker) {
      this.elements.confirmTicker.textContent = ticker || 'No Ticker';
      this.elements.confirmTicker.classList.toggle('wizard-confirmation__ticker--empty', !ticker);
    }

    // Update setup row
    if (this.thesis.setupType) {
      this.elements.confirmSetupRow.style.display = 'flex';
      this.elements.confirmSetup.textContent = this.thesis.setupType.toUpperCase();
    } else {
      this.elements.confirmSetupRow.style.display = 'none';
    }

    // Update theme row
    if (this.thesis.theme) {
      this.elements.confirmThemeRow.style.display = 'flex';
      this.elements.confirmTheme.textContent = this.thesis.theme;
    } else {
      this.elements.confirmThemeRow.style.display = 'none';
    }

    // Show streak preview
    const progress = state.journalMeta.achievements.progress;
    const today = new Date().toDateString();
    const lastDate = progress.lastTradeDate ? new Date(progress.lastTradeDate).toDateString() : null;

    if (lastDate !== today && progress.currentStreak > 0) {
      // Will extend streak
      this.elements.streakDisplay.style.display = 'flex';
      this.elements.streakText.textContent = `${progress.currentStreak + 1} day streak!`;
    } else if (!lastDate) {
      // First trade ever
      this.elements.streakDisplay.style.display = 'flex';
      this.elements.streakText.textContent = 'Start your streak!';
    } else {
      this.elements.streakDisplay.style.display = 'none';
    }
  }

  async confirmTrade() {
    this.collectStepData();
    await this.logTrade(true);
    this.close();
  }

  async logTrade(wizardComplete = false) {
    const trade = state.trade;
    const results = state.results;
    const account = state.account;

    // Validate ticker and fetch company data if API key is configured
    let companyData = null;
    if (priceTracker.apiKey && trade.ticker) {
      try {
        // Show loading toast
        showToast('🔍 Validating ticker...', 'info');

        // Fetch price to validate ticker and company profile in parallel
        const [priceData, profileData] = await Promise.all([
          priceTracker.fetchPrice(trade.ticker),
          priceTracker.fetchCompanyProfile(trade.ticker)
        ]);

        companyData = profileData;
        if (companyData) {
          console.log('[Wizard] Company data fetched:', companyData);
        }
      } catch (error) {
        // If error contains "Invalid ticker", show specific error
        if (error.message.includes('Invalid ticker')) {
          showToast(`❌ ${error.message}`, 'error');
        } else {
          showToast(`❌ Failed to validate ticker: ${error.message}`, 'error');
        }
        return;
      }
    }

    // Get custom trade date from calculator
    const tradeDateInput = document.getElementById('tradeDate');
    const timestamp = createTimestampFromDateInput(tradeDateInput?.value);

    // Build entry
    const entry = {
      timestamp, // Custom timestamp based on trade date
      ticker: trade.ticker,
      entry: trade.entry,
      stop: trade.stop,
      originalStop: trade.stop,
      currentStop: trade.stop,
      target: trade.target,
      shares: results.shares,
      positionSize: results.positionSize,
      riskDollars: results.riskDollars,
      riskPercent: account.riskPercent,
      stopDistance: results.stopDistance,
      notes: this.notes || trade.notes || '',
      status: 'open',

      // Thesis data
      thesis: this.hasThesisData() ? { ...this.thesis } : null,
      wizardComplete,
      wizardSkipped: [...this.skippedSteps],

      // Company data (fetched during validation)
      company: companyData || null
    };

    // Add to journal
    const newEntry = state.addJournalEntry(entry);

    // Update progress
    const progress = state.journalMeta.achievements.progress;
    progress.totalTrades++;

    if (this.notes) {
      progress.tradesWithNotes++;
    }
    if (this.hasThesisData()) {
      progress.tradesWithThesis++;
    }
    if (wizardComplete && this.skippedSteps.length === 0) {
      progress.completeWizardCount++;
    }

    // Update streak
    state.updateStreak();

    // Save progress
    state.saveJournalMeta();

    // Trigger events for achievements/celebrations
    state.emit('tradeLogged', {
      entry: newEntry,
      wizardComplete,
      thesis: this.thesis
    });

    // Show success toast
    this.showSuccessToast();

    // Trigger confetti if celebrations enabled
    if (state.journalMeta.settings.celebrationsEnabled) {
      state.emit('triggerConfetti');
    }
  }

  hasThesisData() {
    return this.thesis.setupType ||
           this.thesis.theme ||
           this.thesis.conviction;
  }

  showSuccessToast() {
    const messages = [
      "✅ Trade logged! Good luck!",
      "🎯 Nice setup! Tracked.",
      "🔥 You're on a roll! Trade saved.",
      "📝 Disciplined trader! Logged.",
      "✅ Trade captured! Let's go!"
    ];
    const message = messages[Math.floor(Math.random() * messages.length)];
    showToast(message, 'success');
  }
}

export const wizard = new TradeWizard();
export { TradeWizard };
