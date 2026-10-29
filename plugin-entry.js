// Mount the native entry immediately; feature modules load after the chrome exists.
import { startKitchenBootstrap } from './core/kitchen-bootstrap.js';

startKitchenBootstrap();
