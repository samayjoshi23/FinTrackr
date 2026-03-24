import { Component, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Snackbar } from '../shared/components/snackbar/snackbar';

@Component({
  selector: 'app-features',
  imports: [CommonModule, RouterOutlet, Snackbar],
  templateUrl: './features.html',
  styleUrl: './features.css',
})
export class Features {
  private readonly router = inject(Router);

  ngOnInit() {
    this.router.navigateByUrl('/user/dashboard');
  }
}
