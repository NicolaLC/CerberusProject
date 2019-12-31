using UnityEngine;

public class PlayerWeaponAnimator : MonoBehaviour
{
  public Animator[] animators;
  private bool isShooting = false;

  public void SetIdle()
  {
    if (isShooting)
    {
      return;
    }
    foreach (Animator anim in animators)
    {
      anim.SetBool("idle", true);
      anim.SetBool("walk", false);
      anim.SetBool("shoot", false);
    }
  }

  public void SetWalk(float walkDirection)
  {
    if (isShooting)
    {
      return;
    }
    foreach (Animator anim in animators)
    {
      anim.SetBool("walk", true);
      anim.SetFloat("walkDirection", walkDirection);
      anim.SetBool("idle", false);
      anim.SetBool("shoot", false);
    }
  }

  public void SetShoot(bool _isShooting, float walkDirection)
  {
    foreach (Animator anim in animators)
    {
      anim.SetBool("shoot", isShooting);
      anim.SetFloat("walkDirection", walkDirection);
      anim.SetBool("walk", false);
      anim.SetBool("idle", false);
      isShooting = _isShooting;
    }
  }
}
