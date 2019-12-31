using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class PlayerShootController : MonoBehaviour
{
  [SerializeField]
  private Weapon[] weapons;
  private PlayerWeaponAnimator playerWeaponAnimator;

  void Awake()
  {
    playerWeaponAnimator = GetComponent<PlayerWeaponAnimator>();
  }

  void Update()
  {
    if (Input.GetMouseButton(0))
    {
      foreach (Weapon weapon in weapons)
      {
        weapon.ShouldShoot();
      }
      playerWeaponAnimator.SetShoot(true, Input.GetAxis("Horizontal"));
    }

    if (Input.GetMouseButtonUp(0))
    {
      foreach (Weapon weapon in weapons)
      {
        weapon.StopShoot();
      }
      playerWeaponAnimator.SetShoot(false, Input.GetAxis("Horizontal"));
    }
  }
}
