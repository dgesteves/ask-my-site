// dist/embed-dialog.global.js: the dialog for the script embed, with production React, Radix, cmdk
// and the dialog's styles. dist/embed.global.js adds it to the page the first time the dialog is
// wanted; on its own it does nothing.
import dialogStyles from '../react/styles.css';
import { render } from './dialog';

if (!document.getElementById('ondocs-dialog-styles')) {
  const style = document.createElement('style');
  style.id = 'ondocs-dialog-styles';
  style.textContent = dialogStyles;
  // After the launcher's, and still before the site's own stylesheets, which override it.
  const launcher = document.getElementById('ondocs-styles');
  if (launcher) launcher.after(style);
  else document.head.prepend(style);
}

window.OndocsDialog = { render };
