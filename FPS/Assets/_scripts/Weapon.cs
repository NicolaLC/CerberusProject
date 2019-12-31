using UnityEngine;

public class Weapon : MonoBehaviour
{
  public int fireRate = 1;
  public float fireDelay = 0;
  public bool automatic = true;
  public float shootDamage = 5f;
  public float maxRange = 1000f;

  [SerializeField]
  private Transform shootPoint;

  [SerializeField]
  private GameObject muzzleFlash;

  [SerializeField]
  private GenericPlayerUserInterface UI;
  private bool shooting = false;

  public void ShouldShoot()
  {
    if (!shooting)
    {
      InvokeRepeating("Shoot", fireDelay, 1f / fireRate);
      shooting = true;
    }
  }

  public void StopShoot()
  {
    CancelInvoke("Shoot");
    muzzleFlash.SetActive(false);
    shooting = false;
  }

  private void Shoot()
  {
    muzzleFlash.SetActive(true);
    RaycastHit hit;
    // Does the ray intersect any objects excluding the player layer
    if (Physics.Raycast(shootPoint.transform.position, shootPoint.transform.forward, out hit, Mathf.Infinity))
    {
      DamageController damage = hit.transform.gameObject.GetComponent<DamageController>();
      if (damage)
      {
        Debug.DrawRay(shootPoint.transform.position, shootPoint.transform.forward * hit.distance, Color.green);
        damage.Damage(shootDamage);
        UI.Hit(shootDamage);
      }
      else
      {
        Debug.DrawRay(shootPoint.transform.position, shootPoint.transform.TransformDirection(Vector3.forward) * 1000, Color.magenta);
        Debug.Log("Did not Hit");
      }
    }
    else
    {
      Debug.DrawRay(shootPoint.transform.position, shootPoint.transform.TransformDirection(Vector3.forward) * 1000, Color.red);
      Debug.Log("Did not Hit");
    }
  }
}
