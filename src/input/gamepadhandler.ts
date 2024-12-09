export class GamepadHandler extends EventTarget {
  private _controllers: { [key: number]: Gamepad };

  constructor() {
    super();
    this._controllers = {};
    window.requestAnimationFrame(this._updateStatus.bind(this));
  }

  /**
   * @param {Gamepad} gamepad
   */
  addGamepad(gamepad: Gamepad) {
    this._controllers[gamepad.index] = gamepad;
  }

  /**
   * @param {Gamepad} gamepad
   */
  removeGamepad(gamepad: Gamepad) {
    delete this._controllers[gamepad.index];
  }

  _updateStatus() {
    this._scanGamepad();
    for (let i in this._controllers) {
      const controller = this._controllers[i];

      this.dispatchEvent(
        new GamepadEvent("gamepadupdated", {
          gamepad: controller,
        })
      );
    }
    window.requestAnimationFrame(this._updateStatus.bind(this));
  }

  _scanGamepad() {
    const gamepads = navigator
      .getGamepads()
      .filter((gamepad) => gamepad !== null);
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i].index in this._controllers) {
        this._controllers[gamepads[i].index] = gamepads[i];
      }
    }
  }
}
