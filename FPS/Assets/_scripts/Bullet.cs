using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class Bullet : MonoBehaviour
{
  [SerializeField]
  private float lifeTime = 5f;
  [SerializeField]
  private float speed = 1f;

  private void Awake()
  {
    Invoke("Destroy", lifeTime);
  }

  private void Start()
  {
    GetComponent<Rigidbody>().AddForce(transform.forward * speed, ForceMode.Impulse);
  }

  void OnCollisionEnter(Collision col)
  {
    CancelInvoke("Destroy");
    Destroy();
  }

  private void Destroy()
  {
    GameObject.Destroy(gameObject);
  }
}
