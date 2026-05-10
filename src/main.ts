import { bootstrapApplication } from '@angular/platform-browser';
import { registerLocaleData } from '@angular/common';
import localeEnIn from '@angular/common/locales/en-IN';
import { appConfig } from './app/app.config';
import { App } from './app/app';

registerLocaleData(localeEnIn);

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
